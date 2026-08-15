"""JSON and image endpoints used by the KOLAMAYA frontend."""
from io import BytesIO

from flask import Blueprint, jsonify, request, send_file
from PIL import Image, UnidentifiedImageError

from backend.services.fragment_reconstruction import FragmentReconstructionService
from backend.services.hybrid_vision import HybridVisionEngine
from backend.services.kolam_recreator import KolamRecreatorService
from backend.services.unet_service import UNetCompletionService

api = Blueprint("api", __name__, url_prefix="/api")
hybrid = HybridVisionEngine()
fragment_reconstructor = FragmentReconstructionService()
recreator = KolamRecreatorService()
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
            "fragmentReconstructionReady": True,
            "recreatorReady": True,
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
                    "part-to-whole fragment reconstruction",
                ],
            },
            "fragmentModel": {
                "id": "kolamaya-fragment-v1",
                "type": "Symmetry-hypothesis reconstruction engine",
                "trained": False,
                "styles": ["mirror4", "rotational4"],
                "note": "Generates a plausible complete kolam from an arbitrary fragment; it cannot guarantee the unknown original.",
            },
            "recreatorModel": {
                "id": "kolamaya-recreator-v1",
                "type": "Known-tile digital rebuilder with clean-trace fallback",
                "trained": False,
                "methods": ["auto", "tiles", "trace"],
                "note": "Recreates a complete uploaded kolam as a clean digital rendering.",
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
                "POST /api/reconstruct": "Multipart fragment + placement + style -> predicted complete PNG",
                "POST /api/recreate": "Multipart complete image + method + palette -> clean recreated PNG",
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


@api.post("/reconstruct")
def reconstruct_fragment():
    """Analyze an arbitrary fragment and generate a plausible complete kolam."""
    image, error = _read_image()
    if error:
        return error

    placement = request.form.get("placement", "auto")
    style = request.form.get("style", "mirror4")
    try:
        output, metadata = fragment_reconstructor.reconstruct(
            image, placement=placement, style=style
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 422

    buffer = BytesIO()
    output.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    response = send_file(
        buffer,
        mimetype="image/png",
        download_name="kolamaya-fragment-reconstruction.png",
    )
    response.headers["X-Kolamaya-Engine"] = metadata["engine"]
    response.headers["X-Kolamaya-Placement"] = metadata["placement"]
    response.headers["X-Kolamaya-Style"] = metadata["style"]
    response.headers["X-Kolamaya-Confidence"] = str(metadata["confidence"])
    response.headers["X-Kolamaya-Coverage"] = str(metadata["coverage"])
    response.headers["X-Kolamaya-Grid"] = metadata["grid"]
    response.headers["X-Kolamaya-Spacing"] = str(metadata["spacing"])
    return response


@api.post("/recreate")
def recreate_kolam():
    """Rebuild a complete uploaded kolam as a clean digital rendering."""
    image, error = _read_image()
    if error:
        return error

    method = request.form.get("method", "auto")
    palette = request.form.get("palette", "heritage")
    thickness = request.form.get("thickness", "2")
    try:
        output, metadata = recreator.recreate(
            image, method=method, palette=palette, thickness=thickness
        )
    except (ValueError, TypeError) as error:
        return jsonify({"error": str(error)}), 422

    buffer = BytesIO()
    output.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    response = send_file(
        buffer,
        mimetype="image/png",
        download_name="kolamaya-recreated.png",
    )
    response.headers["X-Kolamaya-Engine"] = metadata["engine"]
    response.headers["X-Kolamaya-Method"] = metadata["method"]
    response.headers["X-Kolamaya-Palette"] = metadata["palette"]
    response.headers["X-Kolamaya-Confidence"] = str(metadata["confidence"])
    response.headers["X-Kolamaya-Grid"] = metadata["grid"]
    response.headers["X-Kolamaya-Grid-Regularity"] = str(metadata["gridRegularity"])
    response.headers["X-Kolamaya-Tile-Confidence"] = str(metadata["tileConfidence"])
    response.headers["X-Kolamaya-Symmetry"] = str(metadata["symmetry"])
    response.headers["X-Kolamaya-Cells"] = str(metadata["cells"])
    return response
