# KOLAMAYA — Hackathon Full-Stack Project

KOLAMAYA is a full-stack creative-computing studio for generating, completing, and analyzing South Indian kolam patterns. The interface combines a browser pattern engine with a Flask computer-vision API.

## Important model disclosure

The reliable demo runtime uses **KOLAMAYA Hybrid Vision Engine v1**, an explainable computer-vision pipeline—not a pretrained neural network. It performs background-aware segmentation, fuzzy symmetry scoring, dot-lattice detection, 16-class geometric tile-template matching, and deterministic reflection.

A genuine **PyTorch U-Net** architecture, synthetic-data generator, trainer, checkpoint loader, and inference path are included as the neural extension. A trained checkpoint is **not bundled or claimed**. After training, place `kolamaya_unet.pt` in `backend/checkpoints/` and the frontend will automatically enable the U-Net option.

This distinction is intentional and suitable for an honest hackathon presentation.

## Features

- Symmetric procedural kolam generation
- Grid-size and drawing-speed controls
- SVG, PNG, animated GIF, embed-code, and raw-SVG export
- Half-kolam completion through the Flask API
- Part-to-whole prediction from an arbitrary visible kolam fragment
- Automatic fragment-position prediction with mirror or rotational reconstruction
- Full-image Kolam Recreator with 16-tile digital rebuilding
- Automatic clean-trace fallback for photographed or non-grid patterns
- Heritage, monochrome, and source-color recreation palettes
- Browser-side fallback when the backend is unavailable
- Symmetry, dot-grid, tile-confidence, and overall-accuracy analysis
- Explainable 16-class curve-tile classifier
- Optional trainable U-Net completion network
- Responsive KOLAMAYA heritage interface
- API health and model-readiness indicator

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript, SVG, Canvas |
| Backend | Python, Flask |
| Runtime vision model | NumPy + Pillow hybrid computer vision |
| Tile classifier | 16 deterministic geometric templates + fuzzy F1 matching |
| Neural extension | PyTorch U-Net |
| Data | Synthetic paired partial/full kolam masks |

## Quick start

### 1. Create an environment

```bash
python3 -m venv .venv
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Windows:

```powershell
.venv\Scripts\activate
```

### 2. Install the demo dependencies

```bash
pip install -r requirements.txt
```

### 3. Start the full-stack application

```bash
python run.py
```

Open `http://localhost:5000`.

The app must be opened through Flask—not directly from `frontend/index.html`—to use backend inference. Direct opening still activates the browser fallback.

## Deploy on Vercel

This repository is ready for Vercel through the root `app.py`, `vercel.json`, `.python-version`, and `.vercelignore` files.

1. Push the project to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Set the Root Directory to the folder containing `app.py` and `pyproject.toml`. Use `.` only when those files are at the repository root.
4. Leave Build Command and Output Directory empty. Vercel uses the explicit `app:app` Flask entrypoint in `pyproject.toml`.
5. Deploy and verify `/api/health`.

The Vercel build uses the lightweight Hybrid Vision Engine. See `docs/VERCEL_DEPLOYMENT.md` for detailed instructions and model limitations.

## API endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Backend and model readiness |
| GET | `/api/model/info` | Transparent model information |
| GET | `/api/docs` | Machine-readable API summary |
| POST | `/api/analyze` | Analyze an uploaded kolam |
| POST | `/api/complete` | Complete an uploaded half-kolam |
| POST | `/api/reconstruct` | Predict a complete kolam from any visible fragment |
| POST | `/api/recreate` | Redraw a complete uploaded kolam as a clean digital pattern |

### Analyze example

```bash
curl -X POST -F "image=@kolam.png" http://localhost:5000/api/analyze
```

### Complete example

```bash
curl -X POST \
  -F "image=@half-kolam.png" \
  -F "mode=extend-right" \
  -F "engine=hybrid" \
  http://localhost:5000/api/complete \
  --output completed.png
```

Completion modes: `auto`, `vcenter`, `hcenter`, `extend-right`, `extend-left`, `extend-down`, and `extend-up`.

### Part-to-whole reconstruction example

```bash
curl -X POST \
  -F "image=@kolam-fragment.png" \
  -F "placement=auto" \
  -F "style=mirror4" \
  http://localhost:5000/api/reconstruct \
  --output predicted-kolam.png
```

Reconstruction styles are `mirror4` and `rotational4`. This endpoint generates a plausible symmetry-based completion; it cannot guarantee that the unknown original used the same continuation.

### Recreator example

```bash
curl -X POST \
  -F "image=@complete-kolam.png" \
  -F "method=auto" \
  -F "palette=heritage" \
  -F "thickness=2" \
  http://localhost:5000/api/recreate \
  --output recreated-kolam.png
```

`auto` uses the known 16-tile vocabulary when a stable dot grid is recognized and falls back to a clean digital trace otherwise. Methods: `auto`, `tiles`, `trace`. Palettes: `heritage`, `monochrome`, `original`.

## Train the optional U-Net

Install the ML dependency:

```bash
pip install -r requirements-ml.txt
```

Generate synthetic paired masks:

```bash
python -m backend.training.generate_data --samples 2000
```

Train:

```bash
python -m backend.training.train_unet --epochs 25
```

The best checkpoint is saved to `backend/checkpoints/kolamaya_unet.pt`. Restart Flask; `/api/health` will return `"unetReady": true`, and the frontend U-Net option will become available.

For a competitive model, augment the synthetic set with consented, labeled real kolam images and report validation metrics on a held-out test set.

## Tests

```bash
python -m unittest backend.tests.test_api -v
```

## Project structure

```text
KOLAMAYA-hackathon/
├── run.py
├── requirements.txt
├── requirements-ml.txt
├── README.md
├── frontend/
│   ├── index.html
│   └── assets/
│       ├── css/styles.css
│       └── js/
│           ├── kolam-core.js
│           ├── kolam-vision.js
│           └── app.js
├── backend/
│   ├── app.py
│   ├── routes/api.py
│   ├── services/
│   │   ├── hybrid_vision.py
│   │   ├── fragment_reconstruction.py
│   │   ├── kolam_recreator.py
│   │   ├── tile_classifier.py
│   │   └── unet_service.py
│   ├── models/
│   │   ├── unet.py
│   │   └── tile_templates.json
│   ├── training/
│   │   ├── generate_data.py
│   │   └── train_unet.py
│   ├── checkpoints/.gitkeep
│   └── tests/test_api.py
└── docs/
    ├── ARCHITECTURE.md
    ├── MODEL_CARD.md
    └── DEMO_GUIDE.md
```

## Hackathon-ready description

> KOLAMAYA uses an explainable hybrid vision engine for dependable live analysis and completion. It combines classical image segmentation, symmetry reasoning, lattice detection, and a 16-class geometric tile matcher. We also designed a PyTorch U-Net pipeline for learned completion; training and inference infrastructure are included, while the current demo defaults to the validated deterministic engine.

See `docs/DEMO_GUIDE.md` for the presentation flow and `docs/MODEL_CARD.md` for model limitations and responsible-use notes.
