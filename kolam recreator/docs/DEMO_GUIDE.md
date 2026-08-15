# KOLAMAYA Hackathon Demo Guide

## One-line pitch

**KOLAMAYA turns the mathematical language of South Indian kolam into an interactive studio that can create, restore, and explain patterns.**

## Suggested 3-minute demo

### 0:00–0:25 — Problem

“Kolam is an everyday generative art tradition built from dots, curves, repetition, and symmetry. Digital tools often display the final image but do not reveal its underlying structure. KOLAMAYA makes that structure interactive.”

### 0:25–1:05 — Generate

1. Open the Generator tab.
2. Move Grid Size from 5 to 9.
3. Generate two patterns.
4. Play the drawing animation.
5. Open the export menu and mention SVG, PNG, GIF, and embed export.

Key line: “The browser generator uses a 16-tile geometric vocabulary and symmetry constraints, so creation is instant and works offline.”

### 1:05–1:50 — Complete

1. Open Half Completion.
2. Upload a prepared half-kolam image.
3. Point to the header badge showing `Vision API · Hybrid AI`.
4. Select the symmetry axis and run Hybrid Vision completion.
5. Download the result.

Key line: “The default completion engine is deterministic and explainable; it finds the inked side and reflects it around the chosen axis.”

### 1:50–2:30 — Analyze

1. Open Analyzer.
2. Click “Analyze current kolam.”
3. Show vertical, horizontal, and rotational symmetry.
4. Show dot-grid detection and tile confidence.
5. Point to the annotated view.

Key line: “Instead of returning a black-box score, KOLAMAYA shows the measurements and detected structure behind the score.”

### 2:30–3:00 — AI and roadmap

“The reliable demo uses our KOLAMAYA Hybrid Vision Engine: segmentation, fuzzy symmetry, dot-lattice detection, and a 16-class tile matcher. We also include a real PyTorch U-Net architecture, synthetic-data generator, training loop, and inference API. We do not claim untrained weights; the next step is practitioner-reviewed real data and reported validation metrics.”

## Judge questions

### What AI model did you use?

“The current live model is an explainable hybrid computer-vision engine, not a pretrained neural network. It combines image segmentation, symmetry reasoning, lattice detection, and geometric classification. We also built a U-Net completion pipeline that becomes available when a trained checkpoint is loaded.”

### Why not use a large hosted model?

“Kolam structure is geometric, and deterministic methods are faster, private, explainable, and reliable for a live demo. The optional U-Net addresses irregular hand-drawn cases without making the core experience depend on a paid API.”

### What is innovative?

“KOLAMAYA unifies procedural creation, structural restoration, and interpretable analysis in one culturally focused tool. The same 16-tile vocabulary connects generation and recognition.”

### How do you avoid cultural oversimplification?

“We describe the accuracy score as geometric and heuristic—not artistic or cultural quality. A future dataset and evaluation process should involve kolam practitioners and document regional variation.”

### Does it work without a server?

“Yes. Generation, animation, export, and a browser vision fallback still run locally. Flask adds a clear API boundary and model-serving path.”

## Before presenting

- Start the app with `python run.py`.
- Confirm `http://localhost:5000/api/health` returns `status: ok`.
- Keep one clear half-kolam PNG ready.
- Use a 5×5 or 7×7 pattern for a fast animation.
- Do not select U-Net unless a trained checkpoint is loaded.
- Keep `docs/MODEL_CARD.md` open for technical questions.
