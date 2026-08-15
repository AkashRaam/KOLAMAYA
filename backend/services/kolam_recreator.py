"""Recreate an uploaded kolam as a clean digital rendering.

When a dot lattice and known curve tiles can be recognized, the service rebuilds
the image from the 16 geometric source templates. Otherwise it falls back to a
clean high-contrast stroke trace so every readable upload still produces a
useful recreation.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from backend.services.hybrid_vision import HybridVisionEngine

TEMPLATE_FILE = Path(__file__).resolve().parents[1] / "models" / "tile_templates.json"


class KolamRecreatorService:
    version = "kolamaya-recreator-v1"
    methods = {"auto", "tiles", "trace"}
    palettes = {"heritage", "monochrome", "original"}

    def __init__(self):
        self.vision = HybridVisionEngine()
        self.patterns = json.loads(TEMPLATE_FILE.read_text())

    @staticmethod
    def _source_colors(image, mask, background):
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
        ink_pixels = rgb[mask]
        if len(ink_pixels):
            ink = np.median(ink_pixels, axis=0)
        else:
            ink = 255 - background
        return tuple(np.uint8(np.clip(background, 0, 255))), tuple(np.uint8(np.clip(ink, 0, 255)))

    @staticmethod
    def _palette(name, original_background, original_ink):
        if name == "monochrome":
            return (255, 253, 248), (35, 24, 21)
        if name == "original":
            return original_background, original_ink
        return (72, 29, 36), (255, 250, 240)

    def _render_tiles(self, matrix, background, stroke, thickness=2.0):
        rows = len(matrix)
        cols = len(matrix[0]) if rows else 0
        spacing = max(50, min(90, int(900 / max(2, rows, cols))))
        supersample = 3
        canvas = Image.new(
            "RGB",
            ((cols + 1) * spacing * supersample, (rows + 1) * spacing * supersample),
            background,
        )
        draw = ImageDraw.Draw(canvas)
        line_width = max(3, round(thickness * supersample))
        dot_radius = max(3, round(3.2 * supersample))

        for row_index, row in enumerate(matrix):
            for col_index, tile_id in enumerate(row):
                center_x = (col_index + 1) * spacing * supersample
                center_y = (row_index + 1) * spacing * supersample
                draw.ellipse(
                    (
                        center_x - dot_radius,
                        center_y - dot_radius,
                        center_x + dot_radius,
                        center_y + dot_radius,
                    ),
                    fill=stroke,
                )
                tile_index = max(0, min(len(self.patterns) - 1, int(tile_id) - 1))
                points = [
                    (
                        (col_index + 1 + point["x"]) * spacing * supersample,
                        (row_index + 1 + point["y"]) * spacing * supersample,
                    )
                    for point in self.patterns[tile_index]["points"]
                ]
                draw.line(points, fill=stroke, width=line_width, joint="curve")

        return canvas.resize(
            ((cols + 1) * spacing, (rows + 1) * spacing),
            Image.Resampling.LANCZOS,
        )

    @staticmethod
    def _trace(mask, background, stroke):
        ys, xs = np.nonzero(mask)
        if len(xs) == 0:
            raise ValueError("No visible kolam strokes were detected.")
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        margin = max(6, round(max(x1 - x0, y1 - y0) * 0.06))
        x0, y0 = max(0, x0 - margin), max(0, y0 - margin)
        x1, y1 = min(mask.shape[1], x1 + margin), min(mask.shape[0], y1 + margin)
        cropped = Image.fromarray(mask[y0:y1, x0:x1].astype(np.uint8) * 255, mode="L")

        max_side = 1100
        if max(cropped.size) > max_side:
            scale = max_side / max(cropped.size)
            cropped = cropped.resize(
                (max(2, round(cropped.width * scale)), max(2, round(cropped.height * scale))),
                Image.Resampling.LANCZOS,
            )
        # A light blur followed by thresholding suppresses camera noise and
        # produces a smooth, consistent digital stroke.
        smooth = cropped.filter(ImageFilter.GaussianBlur(radius=0.65))
        binary = np.asarray(smooth) > 86
        output = np.empty((binary.shape[0], binary.shape[1], 3), dtype=np.uint8)
        output[:] = background
        output[binary] = stroke
        return Image.fromarray(output, mode="RGB")

    def recreate(self, image, method="auto", palette="heritage", thickness=2.0):
        if method not in self.methods:
            raise ValueError(f"Unknown recreation method: {method}")
        if palette not in self.palettes:
            raise ValueError(f"Unknown recreation palette: {palette}")
        thickness = max(1.0, min(5.0, float(thickness)))

        image = image.convert("RGB")
        mask, estimated_background = self.vision._ink_mask(image)
        if not mask.any():
            raise ValueError("No visible kolam strokes were detected in the image.")
        original_background, original_ink = self._source_colors(image, mask, estimated_background)
        background, stroke = self._palette(palette, original_background, original_ink)
        analysis = self.vision.analyze(image)
        tiles = analysis.get("tiles")
        lattice = analysis["lattice"]
        tile_ready = bool(
            lattice["detected"]
            and tiles
            and 2 <= lattice["rows"] <= 20
            and 2 <= lattice["cols"] <= 20
            and tiles["cellCount"] <= 400
        )

        requested_method = method
        if method == "auto":
            method = "tiles" if tile_ready else "trace"
        if method == "tiles" and not tile_ready:
            method = "trace"
            fallback_reason = "A stable known-tile grid was not detected, so clean tracing was used."
        else:
            fallback_reason = ""

        if method == "tiles":
            output = self._render_tiles(tiles["matrix"], background, stroke, thickness)
            tile_confidence = float(tiles["avgConf"] * 100.0)
            confidence = min(
                98.0,
                0.62 * tile_confidence + 0.23 * lattice["regularity"] + 15.0,
            )
        else:
            output = self._trace(mask, background, stroke)
            tile_confidence = float(tiles["avgConf"] * 100.0) if tiles else 0.0
            contrast = np.max(
                np.abs(np.asarray(image, dtype=np.float32) - estimated_background), axis=2
            )[mask]
            contrast_score = min(100.0, float(contrast.mean() / 1.2)) if len(contrast) else 0.0
            confidence = min(94.0, 0.72 * contrast_score + 0.28 * analysis["symmetry"]["best"])

        metadata = {
            "engine": self.version,
            "method": method,
            "requestedMethod": requested_method,
            "palette": palette,
            "confidence": round(confidence, 1),
            "grid": f"{lattice['rows']}x{lattice['cols']}" if lattice["detected"] else "not-detected",
            "gridRegularity": round(float(lattice["regularity"]), 1),
            "tileConfidence": round(tile_confidence, 1),
            "symmetry": round(float(analysis["symmetry"]["best"]), 1),
            "cells": int(tiles["cellCount"]) if tiles else 0,
            "outputWidth": output.width,
            "outputHeight": output.height,
            "fallbackReason": fallback_reason,
        }
        return output, metadata
