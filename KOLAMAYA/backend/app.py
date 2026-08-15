"""Flask application factory for the KOLAMAYA hackathon demo."""
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

from backend.routes.api import api

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_ROOT / "frontend"


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        # Vercel Functions cap request/response payloads at 4.5 MB.
        MAX_CONTENT_LENGTH=4 * 1024 * 1024,
        JSON_SORT_KEYS=False,
    )
    if test_config:
        app.config.update(test_config)

    app.register_blueprint(api)

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/assets/<path:filename>")
    def frontend_asset(filename):
        return send_from_directory(FRONTEND_DIR / "assets", filename)

    @app.get("/favicon.ico")
    def favicon():
        return "", 204

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": "Image is too large. Maximum upload size is 4 MB."}), 413

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": "Route not found."}), 404

    return app
