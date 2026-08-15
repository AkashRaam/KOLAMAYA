"""Explainable 16-class curve-tile template classifier.

The templates are the same normalized curve coordinates used by the browser
renderer. Classification uses a tolerant F1 overlap score rather than learned
weights, which makes every result reproducible and inspectable.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

TEMPLATE_FILE = Path(__file__).resolve().parents[1] / "models" / "tile_templates.json"
TEMPLATE_SIZE = 32


def _dilate(mask, radius=2):
    mask = mask.astype(bool)
    out = mask.copy()
    h, w = mask.shape
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx * dx + dy * dy > radius * radius:
                continue
            ys = slice(max(0, dy), min(h, h + dy))
            xs = slice(max(0, dx), min(w, w + dx))
            src_y = slice(max(0, -dy), min(h, h - dy))
            src_x = slice(max(0, -dx), min(w, w - dx))
            out[ys, xs] |= mask[src_y, src_x]
    return out


def _soft_f1(sample, template):
    a = sample.astype(bool)
    b = template.astype(bool)
    if not a.any() or not b.any():
        return 0.0
    ad = _dilate(a)
    bd = _dilate(b)
    recall = float((a & bd).sum()) / float(a.sum())
    precision = float((b & ad).sum()) / float(b.sum())
    if recall + precision == 0:
        return 0.0
    return 2.0 * recall * precision / (recall + precision)


@lru_cache(maxsize=1)
def templates():
    patterns = json.loads(TEMPLATE_FILE.read_text())
    rendered = []
    for pattern in patterns:
        image = Image.new("L", (TEMPLATE_SIZE, TEMPLATE_SIZE), 0)
        draw = ImageDraw.Draw(image)
        points = [
            ((point["x"] + 0.5) * TEMPLATE_SIZE, (point["y"] + 0.5) * TEMPLATE_SIZE)
            for point in pattern["points"]
        ]
        draw.line(points, fill=255, width=2, joint="curve")
        c = TEMPLATE_SIZE / 2
        r = TEMPLATE_SIZE * 0.055
        draw.ellipse((c - r, c - r, c + r, c + r), fill=255)
        rendered.append(np.asarray(image) > 0)
    return rendered


def _cell_sample(mask, center_x, center_y, spacing):
    half = max(3.0, spacing / 2.0)
    left = int(round(center_x - half))
    top = int(round(center_y - half))
    right = int(round(center_x + half))
    bottom = int(round(center_y + half))
    canvas = np.zeros((max(2, bottom - top), max(2, right - left)), dtype=np.uint8)
    src_left, src_top = max(0, left), max(0, top)
    src_right, src_bottom = min(mask.shape[1], right), min(mask.shape[0], bottom)
    if src_right > src_left and src_bottom > src_top:
        canvas[src_top - top : src_bottom - top, src_left - left : src_right - left] = (
            mask[src_top:src_bottom, src_left:src_right].astype(np.uint8) * 255
        )
    image = Image.fromarray(canvas, mode="L").resize(
        (TEMPLATE_SIZE, TEMPLATE_SIZE), resample=Image.Resampling.NEAREST
    )
    return np.asarray(image) > 0


def classify_grid(mask, rows, cols, spacing):
    """Return tile matrix, confidence matrix, and frequency distribution."""
    if len(rows) < 2 or len(cols) < 2 or spacing <= 0:
        return None
    library = templates()
    matrix, confidences = [], []
    distribution = {}
    total = 0.0
    count = 0
    for y in rows:
        row_ids, row_conf = [], []
        for x in cols:
            sample = _cell_sample(mask, x, y, spacing)
            scores = [_soft_f1(sample, template) for template in library]
            tile_id = int(np.argmax(scores)) + 1
            confidence = float(max(scores))
            row_ids.append(tile_id)
            row_conf.append(round(confidence, 3))
            distribution[str(tile_id)] = distribution.get(str(tile_id), 0) + 1
            total += confidence
            count += 1
        matrix.append(row_ids)
        confidences.append(row_conf)
    return {
        "avgConf": total / count if count else 0.0,
        "matrix": matrix,
        "confs": confidences,
        "distribution": distribution,
        "cellCount": count,
    }
