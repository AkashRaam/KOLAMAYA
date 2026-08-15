# Deploy KOLAMAYA on Vercel

The default Vercel build deploys the Flask application and the lightweight KOLAMAYA Hybrid Vision Engine. It intentionally excludes PyTorch training files and neural checkpoints.

## GitHub deployment

1. Push the entire project to a public or private GitHub repository.
2. Sign in to [Vercel](https://vercel.com) with GitHub.
3. Select **Add New → Project**.
4. Import the `KOLAMAYA` repository.
5. Set **Root Directory** to the folder that directly contains `app.py`, `pyproject.toml`, `backend/`, and `frontend/`. Use `.` only if those files are at the repository root. If GitHub shows them inside `KOLAMAYA-hackathon/`, select that folder instead.
6. Vercel detects Flask through `[tool.vercel] entrypoint = "app:app"` in `pyproject.toml`.
7. Do not set a build command or output directory.
8. Select **Deploy**.

After deployment, verify:

```text
https://YOUR-PROJECT.vercel.app/
https://YOUR-PROJECT.vercel.app/api/health
https://YOUR-PROJECT.vercel.app/api/model/info
```

The health route should report `status: ok`, `defaultEngine: hybrid`, and `unetReady: false`.

## CLI deployment

```bash
npm install -g vercel
vercel login
vercel
```

For the production URL:

```bash
vercel --prod
```

## Files used by Vercel

- `app.py` — WSGI entrypoint exposing the Flask `app` variable
- `vercel.json` — function duration and required static/data files
- `.python-version` — Python 3.12
- `.vercelignore` — keeps training assets and development files out of the serverless bundle
- `requirements.txt` — lightweight Flask, Pillow, and NumPy dependencies

## Deployment model

Use `kolamaya-hybrid-v1` on standard Vercel Functions. The PyTorch U-Net is not included in the default Vercel build because PyTorch and checkpoint files significantly increase bundle size and cold-start time. Deploy the neural model separately on a GPU/model platform if it becomes necessary, then call it from Flask.

## Upload limit

Keep demo images below 4 MB. Vercel applies its own serverless request/response payload limit before Flask processes a request.
