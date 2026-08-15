"""Part-to-whole kolam reconstruction.

Given an arbitrary visible fragment, this service segments the ink, estimates its
position and grid clues, then generates a plausible complete composition using
four-way mirror or rotational symmetry. The result is a symmetry hypothesis,
not a claim that the unknown historical original has been recovered exactly.
"""

import numpy as np
from PIL import Image, ImageOps

from backend.services.hybrid_vision import HybridVisionEngine


class FragmentReconstructionService:
    version = "kolamaya-fragment-v1"
    placements = {"auto", "top-left", "top-right", "bottom-left", "bottom-right"}
    styles = {"mirror4", "rotational4"}

    def __init__(self):
        self.vision = HybridVisionEngine()

    @staticmethod
    def _ink_bbox(mask):
        ys, xs = np.nonzero(mask)
        if len(xs) == 0:
            return None
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

    @staticmethod
    def _predict_placement(bbox, width, height):
        x0, y0, x1, y1 = bbox
        center_x = ((x0 + x1) / 2.0) / max(1, width)
        center_y = ((y0 + y1) / 2.0) / max(1, height)
        margin_ratios = [x0 / width, (width - x1) / width, y0 / height, (height - y1) / height]
        tightly_cropped = max(margin_ratios) < 0.12
        if tightly_cropped or (0.42 <= center_x <= 0.58 and 0.42 <= center_y <= 0.58):
            return "top-left", 0.52
        horizontal = "left" if center_x <= 0.5 else "right"
        vertical = "top" if center_y <= 0.5 else "bottom"
        distance = abs(center_x - 0.5) + abs(center_y - 0.5)
        confidence = min(0.88, 0.58 + distance * 0.42)
        return f"{vertical}-{horizontal}", confidence

    @staticmethod
    def _canonical_top_left(fragment, placement):
        if placement == "top-right":
            return ImageOps.mirror(fragment)
        if placement == "bottom-left":
            return ImageOps.flip(fragment)
        if placement == "bottom-right":
            return ImageOps.flip(ImageOps.mirror(fragment))
        return fragment

    @staticmethod
    def _mirror_four(fragment, background):
        width, height = fragment.size
        output = Image.new("RGB", (width * 2, height * 2), tuple(background))
        output.paste(fragment, (0, 0))
        output.paste(ImageOps.mirror(fragment), (width, 0))
        output.paste(ImageOps.flip(fragment), (0, height))
        output.paste(ImageOps.flip(ImageOps.mirror(fragment)), (width, height))
        return output

    @staticmethod
    def _rotational_four(fragment, background):
        width, height = fragment.size
        quadrant = max(width, height)
        tile = Image.new("RGB", (quadrant, quadrant), tuple(background))
        tile.paste(fragment, ((quadrant - width) // 2, (quadrant - height) // 2))
        output = Image.new("RGB", (quadrant * 2, quadrant * 2), tuple(background))
        output.paste(tile, (0, 0))
        output.paste(tile.rotate(-90, resample=Image.Resampling.BICUBIC), (quadrant, 0))
        output.paste(tile.rotate(90, resample=Image.Resampling.BICUBIC), (0, quadrant))
        output.paste(tile.rotate(180, resample=Image.Resampling.BICUBIC), (quadrant, quadrant))
        return output

    def reconstruct(self, image, placement="auto", style="mirror4"):
        if placement not in self.placements:
            raise ValueError(f"Unknown fragment placement: {placement}")
        if style not in self.styles:
            raise ValueError(f"Unknown reconstruction style: {style}")

        image = image.convert("RGB")
        mask, background = self.vision._ink_mask(image)
        bbox = self._ink_bbox(mask)
        if bbox is None:
            raise ValueError("No visible kolam strokes were detected in the fragment.")

        original_bbox = bbox
        width, height = image.size
        x0, y0, x1, y1 = bbox
        margin = max(4, int(max(x1 - x0, y1 - y0) * 0.08))
        x0, y0 = max(0, x0 - margin), max(0, y0 - margin)
        x1, y1 = min(width, x1 + margin), min(height, y1 + margin)
        fragment = image.crop((x0, y0, x1, y1))
        fragment_mask = mask[y0:y1, x0:x1]

        # Remove unrelated background variation while retaining the original ink color.
        fragment_array = np.asarray(fragment).copy()
        cleaned = np.empty_like(fragment_array)
        cleaned[:] = np.clip(background, 0, 255).astype(np.uint8)
        cleaned[fragment_mask] = fragment_array[fragment_mask]
        fragment = Image.fromarray(cleaned, mode="RGB")

        # Limit serverless response size and reconstruction latency.
        max_fragment_side = 700
        if max(fragment.size) > max_fragment_side:
            scale = max_fragment_side / max(fragment.size)
            fragment = fragment.resize(
                (max(2, round(fragment.width * scale)), max(2, round(fragment.height * scale))),
                Image.Resampling.LANCZOS,
            )

        if placement == "auto":
            resolved_placement, placement_confidence = self._predict_placement(
                original_bbox, width, height
            )
        else:
            resolved_placement, placement_confidence = placement, 0.96

        canonical = self._canonical_top_left(fragment, resolved_placement)
        background_tuple = tuple(np.clip(background, 0, 255).astype(np.uint8).tolist())
        if style == "rotational4":
            output = self._rotational_four(canonical, background_tuple)
        else:
            output = self._mirror_four(canonical, background_tuple)

        analysis = self.vision.analyze(image)
        lattice = analysis["lattice"]
        contrast = np.max(
            np.abs(np.asarray(image, dtype=np.float32) - background), axis=2
        )[mask]
        contrast_score = min(1.0, float(contrast.mean() / 120.0)) if len(contrast) else 0.0
        grid_bonus = 0.12 if lattice["detected"] else 0.0
        confidence = min(0.98, 0.50 * placement_confidence + 0.38 * contrast_score + grid_bonus)

        metadata = {
            "engine": self.version,
            "placement": resolved_placement,
            "style": style,
            "confidence": round(confidence * 100.0, 1),
            "coverage": round(float(mask.mean()) * 100.0, 2),
            "bbox": list(original_bbox),
            "gridDetected": bool(lattice["detected"]),
            "grid": f"{lattice['rows']}x{lattice['cols']}" if lattice["detected"] else "not-detected",
            "spacing": round(float(lattice["spacing"]), 1),
            "outputWidth": output.width,
            "outputHeight": output.height,
            "note": "Plausible symmetry reconstruction; the unknown original may differ.",
        }
        return output, metadata
