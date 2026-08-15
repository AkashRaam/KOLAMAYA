"""JSON and image endpoints used by the KOLAMAYA frontend."""
from io import BytesIO

from flask import Blueprint, jsonify, request, send_file
from PIL import Image, UnidentifiedImageError

from backend.services.hybrid_vision import HybridVisionEngine
from backend.services.unet_service import UNetCompletionService

api = Blueprint("api", __name__, url_prefix="/api")
hybrid = HybridVisionEngine()
unet = UNetCompletionService()

ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP", "BMP", "GIF"}


def _read_image():
    upload = request.files.get("image")
    if upload is None or not upload.filename:
        return None, (jsonify({"error": "Upload an image in the 'image' form field."}), 400)
    try:
        image = Image.open(upload.stream)
        image.load()
        if image.format and image.format.upper() not in ALLOWED_FORMATS:
            return None, (jsonify({"error": f"Unsupported image format: {image.format}."}), 415)
        return image.convert("RGB"), None
    except (UnidentifiedImageError, OSError):
        return None, (jsonify({"error": "The uploaded file is not a readable image."}), 415)


@api.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "KOLAMAYA Vision API",
            "version": "1.0.0",
            "defaultEngine": "hybrid",
            "unetReady": unet.is_ready,
        }
    )


@api.get("/model/info")
def model_info():
    return jsonify(
        {
            "name": "KOLAMAYA Vision Engine",
            "version": "1.0.0",
            "runtimeModel": {
                "id": "kolamaya-hybrid-v1",
                "type": "Explainable computer-vision pipeline",
                "trained": False,
                "components": [
                    "background-aware ink segmentation",
                    "fuzzy bilateral and rotational symmetry scoring",
                    "dot-lattice detection",
                    "16-class geometric tile-template classifier",
                    "deterministic reflection completion",
                ],
            },
            "neuralExtension": {
                "id": "kolamaya-unet-v1",
                "type": "PyTorch U-Net image-completion network",
                "ready": unet.is_ready,
                "checkpoint": unet.checkpoint_name,
                "note": "Training code is included. A trained checkpoint is not bundled or claimed.",
            },
        }
    )


@api.get("/docs")
def api_docs():
    return jsonify(
        {
            "service": "KOLAMAYA Vision API",
            "endpoints": {
                "GET /api/health": "Backend and model readiness",
                "GET /api/model/info": "Transparent runtime-model description",
                "POST /api/analyze": "Multipart image -> symmetry, lattice, tile, and accuracy metrics",
                "POST /api/complete": "Multipart image + mode + engine -> completed PNG",
            },
            "completionModes": [
                "auto",
                "vcenter",
                "hcenter",
                "extend-right",
                "extend-left",
                "extend-down",
                "extend-up",
            ],
            "engines": ["hybrid", "unet"],
        }
    )


@api.post("/analyze")
def analyze():
    image, error = _read_image()
    if error:
        return error
    result = hybrid.analyze(image)
    result["engine"] = "kolamaya-hybrid-v1"
    return jsonify(result)


@api.post("/complete")
def complete():
    image, error = _read_image()
    if error:
        return error

    mode = request.form.get("mode", "auto")
    engine = request.form.get("engine", "hybrid").lower()
    allowed_modes = {
        "auto",
        "vcenter",
        "hcenter",
        "extend-right",
        "extend-left",
        "extend-down",
        "extend-up",
    }
    if mode not in allowed_modes:
        return jsonify({"error": f"Unknown completion mode: {mode}."}), 400

    if engine == "unet":
        if not unet.is_ready:
            return (
                jsonify(
                    {
                        "error": "U-Net is not ready. Train it and place kolamaya_unet.pt in backend/checkpoints, or use the hybrid engine.",
                        "fallback": "hybrid",
                    }
                ),
                503,
            )
        output = unet.complete(image, mode=mode)
        used_engine = "kolamaya-unet-v1"
    elif engine == "hybrid":
        output, resolved_mode = hybrid.complete(image, mode=mode)
        used_engine = "kolamaya-hybrid-v1"
        mode = resolved_mode
    else:
        return jsonify({"error": f"Unknown engine: {engine}."}), 400

    buffer = BytesIO()
    output.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    response = send_file(buffer, mimetype="image/png", download_name="kolamaya-completed.png")
    response.headers["X-Kolamaya-Engine"] = used_engine
    response.headers["X-Kolamaya-Mode"] = mode
    return response
