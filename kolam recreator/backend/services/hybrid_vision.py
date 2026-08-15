"""KOLAMAYA's default explainable computer-vision engine.

This is intentionally deterministic. It combines background-aware segmentation,
fuzzy symmetry comparison, dot-lattice estimation, geometric tile matching, and
reflection. It is the reliable runtime engine used by the demo; it is not
misrepresented as a trained neural network.
"""
from typing import Iterable

import numpy as np
from PIL import Image

from backend.services.tile_classifier import classify_grid


class HybridVisionEngine:
    version = "kolamaya-hybrid-v1"

    @staticmethod
    def _resize(image: Image.Image, max_dim: int):
        width, height = image.size
        scale = min(1.0, float(max_dim) / max(width, height))
        if scale == 1.0:
            return image.copy(), scale
        resized = image.resize(
            (max(2, round(width * scale)), max(2, round(height * scale))),
            Image.Resampling.LANCZOS,
        )
        return resized, scale

    @staticmethod
    def _ink_mask(image: Image.Image, threshold: float = 58.0):
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
        border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0)
        background = np.median(border, axis=0)
        difference = np.max(np.abs(rgb - background), axis=2)
        return difference > threshold, background

    @staticmethod
    def _dilate(mask, radius=2):
        source = mask.astype(bool)
        out = source.copy()
        height, width = source.shape
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if abs(dx) + abs(dy) > radius:
                    continue
                ys = slice(max(0, dy), min(height, height + dy))
                xs = slice(max(0, dx), min(width, width + dx))
                src_y = slice(max(0, -dy), min(height, height - dy))
                src_x = slice(max(0, -dx), min(width, width - dx))
                out[ys, xs] |= source[src_y, src_x]
        return out

    def _symmetry(self, mask, axis):
        fuzzy = self._dilate(mask, radius=2)
        flipped = {
            "horizontal": np.flipud(fuzzy),
            "vertical": np.fliplr(fuzzy),
            "rotational": np.flipud(np.fliplr(fuzzy)),
        }[axis]
        intersection = np.logical_and(fuzzy, flipped).sum()
        union = np.logical_or(fuzzy, flipped).sum()
        return float(intersection / union) if union else 0.0

    @staticmethod
    def _autocorrelation_peak(signal, minimum=4):
        signal = np.asarray(signal, dtype=np.float64)
        signal -= signal.mean()
        denominator = float(np.dot(signal, signal))
        if denominator < 1e-8:
            return 0
        best_lag, best_score = 0, -1.0
        maximum = max(minimum, len(signal) // 2)
        for lag in range(minimum, maximum + 1):
            score = float(np.dot(signal[:-lag], signal[lag:]) / denominator)
            if score > best_score:
                best_lag, best_score = lag, score
        return best_lag if best_score > 0.18 else 0

    @staticmethod
    def _cluster(values: Iterable[float], tolerance: float):
        ordered = sorted(float(value) for value in values)
        if not ordered:
            return []
        groups = [[ordered[0]]]
        for value in ordered[1:]:
            if value - groups[-1][-1] <= tolerance:
                groups[-1].append(value)
            else:
                groups.append([value])
        return [sum(group) / len(group) for group in groups]

    @staticmethod
    def _median_gap(values):
        if len(values) < 2:
            return 0.0
        return float(np.median(np.diff(np.asarray(values, dtype=np.float64))))

    @staticmethod
    def _gap_regularity(values):
        if len(values) < 2:
            return 0.0
        gaps = np.diff(np.asarray(values, dtype=np.float64))
        mean = float(gaps.mean())
        if mean <= 0:
            return 0.0
        residual = float(np.abs(gaps - mean).mean() / mean)
        return max(0.0, min(100.0, 100.0 * (1.0 - residual)))

    def _detect_lattice(self, mask):
        height, width = mask.shape
        row_sums = mask.sum(axis=1)
        col_sums = mask.sum(axis=0)
        row_spacing = self._autocorrelation_peak(row_sums)
        col_spacing = self._autocorrelation_peak(col_sums)
        candidates = [value for value in (row_spacing, col_spacing) if value]
        spacing_hint = float(np.mean(candidates)) if candidates else 0.0
        minimum_distance = spacing_hint or max(4.0, min(width, height) / 18.0)

        # Integral-image local-density search finds solid dot centers. Sampling
        # every other pixel keeps analysis fast for a live hackathon demo.
        integral = np.pad(mask.astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)

        def density(x, y, radius):
            x0, x1 = max(0, x - radius), min(width - 1, x + radius)
            y0, y1 = max(0, y - radius), min(height - 1, y + radius)
            total = (
                integral[y1 + 1, x1 + 1]
                - integral[y0, x1 + 1]
                - integral[y1 + 1, x0]
                + integral[y0, x0]
            )
            return float(total) / ((x1 - x0 + 1) * (y1 - y0 + 1))

        candidates = []
        for y in range(1, height - 1, 2):
            for x in range(1, width - 1, 2):
                if not mask[y, x]:
                    continue
                strength = max(density(x, y, 2), density(x, y, 3), density(x, y, 4))
                if strength > 0.54:
                    candidates.append((strength, x, y))
        candidates.sort(reverse=True)

        dots = []
        min_squared = minimum_distance * minimum_distance
        for strength, x, y in candidates:
            if all((x - dx) ** 2 + (y - dy) ** 2 >= min_squared for dx, dy, _ in dots):
                dots.append((x, y, strength))
                if len(dots) >= 225:
                    break

        if len(dots) < 4:
            return {
                "detected": False,
                "rows": [],
                "cols": [],
                "spacing": spacing_hint,
                "regularity": 0.0,
                "dots": dots,
            }

        tolerance = max(2.0, minimum_distance * 0.35)
        rows = self._cluster((dot[1] for dot in dots), tolerance)
        cols = self._cluster((dot[0] for dot in dots), tolerance)

        # Reject implausibly fragmented grids caused by dense brush texture.
        if len(rows) > 24 or len(cols) > 24:
            rows, cols = [], []

        row_gap = self._median_gap(rows)
        col_gap = self._median_gap(cols)
        gaps = [gap for gap in (row_gap, col_gap) if gap > 0]
        spacing = float(np.mean(gaps)) if gaps else spacing_hint
        regularity = (
            (self._gap_regularity(rows) + self._gap_regularity(cols)) / 2.0
            if len(rows) >= 2 and len(cols) >= 2
            else 0.0
        )
        return {
            "detected": len(rows) >= 2 and len(cols) >= 2,
            "rows": rows,
            "cols": cols,
            "spacing": spacing,
            "regularity": regularity,
            "dots": dots,
        }

    def analyze(self, image: Image.Image):
        original_width, original_height = image.size
        working_image, scale = self._resize(image, 360)
        mask, _background = self._ink_mask(working_image)

        symmetry_image, _ = self._resize(image, 800)
        symmetry_mask, _ = self._ink_mask(symmetry_image)
        horizontal = self._symmetry(symmetry_mask, "horizontal") * 100.0
        vertical = self._symmetry(symmetry_mask, "vertical") * 100.0
        rotational = self._symmetry(symmetry_mask, "rotational") * 100.0
        best = max(horizontal, vertical, rotational)

        lattice = self._detect_lattice(mask)
        tiles = None
        if lattice["detected"]:
            tiles = classify_grid(
                mask,
                lattice["rows"],
                lattice["cols"],
                lattice["spacing"],
            )

        tile_confidence = tiles["avgConf"] * 100.0 if tiles else 0.0
        dot_score = 100.0 if lattice["detected"] else 0.0
        accuracy = round(
            0.35 * best
            + 0.35 * tile_confidence
            + 0.20 * lattice["regularity"]
            + 0.10 * dot_score
        )
        inverse_scale = 1.0 / scale
        return {
            "width": original_width,
            "height": original_height,
            "scale": scale,
            "inkFraction": float(mask.mean()),
            "symmetry": {
                "horizontal": horizontal,
                "vertical": vertical,
                "rotational": rotational,
                "best": best,
            },
            "lattice": {
                "detected": lattice["detected"],
                "rows": len(lattice["rows"]),
                "cols": len(lattice["cols"]),
                "spacing": lattice["spacing"] * inverse_scale,
                "dotCount": len(lattice["dots"]),
                "regularity": lattice["regularity"],
                "dots": [
                    {"x": dot[0] * inverse_scale, "y": dot[1] * inverse_scale}
                    for dot in lattice["dots"]
                ],
                "rowsAt": [value * inverse_scale for value in lattice["rows"]],
                "colsAt": [value * inverse_scale for value in lattice["cols"]],
            },
            "tiles": tiles,
            "accuracy": max(0, min(100, accuracy)),
        }

    def _auto_axis(self, mask):
        height, width = mask.shape
        left, right = mask[:, : width // 2].sum(), mask[:, width // 2 :].sum()
        horizontal_total = left + right
        if horizontal_total == 0 or min(left, right) < horizontal_total * 0.05:
            return "vcenter"
        top, bottom = mask[: height // 2].sum(), mask[height // 2 :].sum()
        vertical_total = top + bottom
        if vertical_total == 0 or min(top, bottom) < vertical_total * 0.05:
            return "hcenter"
        return "extend-right"

    def complete(self, image: Image.Image, mode="auto"):
        source = np.asarray(image.convert("RGB"))
        mask, _ = self._ink_mask(image)
        if mode == "auto":
            mode = self._auto_axis(mask)
        height, width = mask.shape

        if mode == "vcenter":
            output = source.copy()
            left = mask[:, : width // 2].sum()
            right = mask[:, width // 2 :].sum()
            mirrored = source[:, ::-1]
            if left >= right:
                output[:, width // 2 :] = mirrored[:, width // 2 :]
            else:
                output[:, : width // 2] = mirrored[:, : width // 2]
        elif mode == "hcenter":
            output = source.copy()
            top = mask[: height // 2].sum()
            bottom = mask[height // 2 :].sum()
            mirrored = source[::-1, :]
            if top >= bottom:
                output[height // 2 :, :] = mirrored[height // 2 :, :]
            else:
                output[: height // 2, :] = mirrored[: height // 2, :]
        elif mode == "extend-right":
            output = np.concatenate((source, source[:, ::-1]), axis=1)
        elif mode == "extend-left":
            output = np.concatenate((source[:, ::-1], source), axis=1)
        elif mode == "extend-down":
            output = np.concatenate((source, source[::-1, :]), axis=0)
        elif mode == "extend-up":
            output = np.concatenate((source[::-1, :], source), axis=0)
        else:
            raise ValueError(f"Unsupported completion mode: {mode}")
        return Image.fromarray(output.astype(np.uint8), mode="RGB"), mode
