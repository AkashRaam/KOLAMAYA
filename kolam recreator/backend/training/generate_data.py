"""Generate paired synthetic partial/full kolam masks for U-Net training.

Run from the project root:
    python -m backend.training.generate_data --samples 2000
"""
import argparse
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


def _half_pattern(size, rng):
    scale = 2
    canvas = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(canvas)
    grid = rng.choice([5, 7, 9])
    spacing = (size * scale * 0.78) / grid
    origin_x = size * scale * 0.08
    origin_y = size * scale * 0.11
    line_width = rng.choice([3, 4, 5])

    for row in range(grid):
        y = origin_y + row * spacing
        for col in range((grid + 1) // 2):
            x = origin_x + col * spacing
            radius = max(2, line_width)
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
            box_radius = spacing * rng.uniform(0.34, 0.48)
            box = (x - box_radius, y - box_radius, x + box_radius, y + box_radius)
            start = rng.choice([0, 90, 180, 270])
            extent = rng.choice([90, 180, 270])
            draw.arc(box, start=start, end=start + extent, fill=255, width=line_width)
            if rng.random() < 0.35:
                draw.line((x, y - box_radius, x + box_radius, y), fill=255, width=line_width)

    canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return canvas.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.0, 0.45)))


def generate_pair(size, rng):
    half_drawing = _half_pattern(size, rng)
    half = Image.new("L", (size, size), 0)
    half.paste(half_drawing.crop((0, 0, size // 2, size)), (0, 0))
    target = half.copy()
    reflected = ImageOps.mirror(half)
    target.paste(reflected.crop((size // 2, 0, size, size)), (size // 2, 0))
    return half, target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/synthetic")
    parser.add_argument("--samples", type=int, default=2000)
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    root = Path(args.output)
    input_dir, target_dir = root / "input", root / "target"
    input_dir.mkdir(parents=True, exist_ok=True)
    target_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)

    for index in range(args.samples):
        partial, full = generate_pair(args.size, rng)
        filename = f"kolam_{index:05d}.png"
        partial.save(input_dir / filename)
        full.save(target_dir / filename)
        if (index + 1) % 100 == 0:
            print(f"Generated {index + 1}/{args.samples}")
    print(f"Dataset written to {root.resolve()}")


if __name__ == "__main__":
    main()
