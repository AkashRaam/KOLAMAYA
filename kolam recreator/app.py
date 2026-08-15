"""Vercel WSGI entrypoint for KOLAMAYA."""
from backend.app import create_app

app = create_app()
