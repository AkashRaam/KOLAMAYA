# Model Card — KOLAMAYA Vision Engine

## 1. Runtime model

**Name:** KOLAMAYA Hybrid Vision Engine v1  
**Identifier:** `kolamaya-hybrid-v1`  
**Type:** Explainable deterministic computer-vision pipeline  
**Training:** None  
**Status:** Default demo engine

### Components

1. Border-median background estimation
2. Color-distance ink segmentation
3. Morphological dilation for stroke tolerance
4. Bilateral and 180-degree symmetry IoU
5. Projection autocorrelation and local-density dot detection
6. Dot-row and dot-column clustering
7. Sixteen-class normalized geometric tile templates
8. Fuzzy F1 overlap classification
9. Reflection-based completion

### Intended use

- Analyze clear kolam images with visible contrast
- Estimate symmetry and dot-grid regularity
- Classify generator-style curve cells
- Complete a clean half pattern through known symmetry
- Provide explainable hackathon demonstrations

### Not intended for

- Cultural-authenticity scoring
- Ranking artists or judging artistic quality
- Forensic image analysis
- Highly cluttered photographs without preprocessing
- Medical, safety-critical, or identity-related decisions

### Limitations

- Accuracy is a heuristic composite score, not a human aesthetic judgment.
- Background texture, shadows, perspective, and low contrast may reduce segmentation quality.
- Dot detection may confuse dense curve intersections with solid dots.
- Tile matching works best for patterns close to the included 16-tile vocabulary.
- Reflection completion assumes an appropriate axis selected by the user or auto-detector.

## 2. Fragment reconstruction model

**Name:** KOLAMAYA Part-to-Whole Engine v1  
**Identifier:** `kolamaya-fragment-v1`  
**Type:** Explainable symmetry-hypothesis generator  
**Training:** None  
**Input:** Any visible kolam fragment with sufficient contrast

The engine segments the visible strokes, estimates the fragment's likely quadrant from its position and surrounding whitespace, extracts grid clues, and constructs either a four-way mirror or four-fold rotational completion. Its confidence score combines placement certainty, stroke/background contrast, and lattice evidence.

The generated result is one geometrically plausible completion. An arbitrary fragment usually does not contain enough information to recover a unique original design, so the interface and API explicitly communicate this uncertainty.

## 3. Kolam Recreator

**Name:** KOLAMAYA Recreator v1  
**Identifier:** `kolamaya-recreator-v1`  
**Type:** Known-tile digital rebuilder with clean-trace fallback  
**Training:** None

The Recreator analyzes a complete uploaded image. When it recognizes a stable dot lattice and cells from the 16-tile vocabulary, it redraws every dot and curve from normalized geometric source templates. Otherwise it segments and smooths the visible strokes into a clean high-contrast trace. The reconstruction report exposes which method was used, grid size, tile confidence, symmetry, and recreation score.

## 4. Neural extension

**Name:** KOLAMAYA U-Net v1  
**Identifier:** `kolamaya-unet-v1`  
**Type:** Four-level convolutional encoder-decoder with skip connections  
**Input:** `1 × 256 × 256` partial binary ink mask  
**Output:** `1 × 256 × 256` completed-mask logits  
**Loss:** Binary cross-entropy plus Dice loss  
**Status:** Architecture and training pipeline included; no trained checkpoint bundled

### Training data

`backend/training/generate_data.py` creates paired synthetic images:

- Input: left-half procedural dot-and-curve mask
- Target: bilateral completed mask
- Default resolution: 256 × 256
- Default random seed: 42

Synthetic data is useful for pipeline validation but does not represent the full variety of regional and hand-drawn kolams. A production model should add consented real examples, clear licenses, multiple drawing media, varied lighting, and a held-out test set.

### Required evaluation before claiming performance

- Dice coefficient and IoU on a held-out dataset
- Stroke continuity rate
- Symmetry error
- Human review by kolam practitioners
- Performance by image source: generated, scanned, photographed, and hand-drawn
- Failure-case documentation

## 5. Transparency statement for judges

The live demo is powered by the deterministic hybrid engine unless `/api/health` reports `unetReady: true`. The source code never silently labels the heuristic engine as a trained model. The API, interface status badge, and this model card expose the active engine.

## 6. Privacy

Uploaded images are processed in memory. The included Flask application does not save uploads, predictions, or personal metadata.
