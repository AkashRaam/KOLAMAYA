"""Optional U-Net checkpoint loading and inference."""
from pathlib import Path

import numpy as np
from PIL import Image

CHECKPOINT = Path(__file__).resolve().parents[1] / "checkpoints" / "kolamaya_unet.pt"


class UNetCompletionService:
    checkpoint_name = "backend/checkpoints/kolamaya_unet.pt"

    def __init__(self, checkpoint=CHECKPOINT):
        self.checkpoint = Path(checkpoint)
        self.model = None
        self.device = None
        self._torch = None
        self.load_error = None
        self._load_if_available()

    def _load_if_available(self):
        if not self.checkpoint.exists():
            self.load_error = "checkpoint-not-found"
            return
        try:
            import torch
            from backend.models.unet import KolamayaUNet

            self._torch = torch
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model = KolamayaUNet().to(self.device)
            payload = torch.load(self.checkpoint, map_location=self.device)
            state = payload.get("model_state", payload) if isinstance(payload, dict) else payload
            self.model.load_state_dict(state)
            self.model.eval()
            self.load_error = None
        except Exception as error:  # Status endpoint reports unavailable without crashing Flask.
            self.model = None
            self.load_error = str(error)

    @property
    def is_ready(self):
        return self.model is not None

    @staticmethod
    def _mask_and_palette(image):
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
        border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0)
        background = np.median(border, axis=0)
        distance = np.max(np.abs(rgb - background), axis=2)
        mask = distance > 55
        ink_pixels = rgb[mask]
        ink = np.median(ink_pixels, axis=0) if len(ink_pixels) else (255 - background)
        return mask, background, ink

    def complete(self, image, mode="vcenter"):
        if not self.is_ready:
            raise RuntimeError("U-Net checkpoint is not loaded.")
        mask, background, ink = self._mask_and_palette(image)
        height, width = mask.shape

        if mode in {"extend-right", "extend-left"}:
            network_input = np.zeros((height, width * 2), dtype=bool)
            if mode == "extend-right":
                network_input[:, :width] = mask
            else:
                network_input[:, width:] = mask
        elif mode in {"extend-down", "extend-up"}:
            network_input = np.zeros((height * 2, width), dtype=bool)
            if mode == "extend-down":
                network_input[:height] = mask
            else:
                network_input[height:] = mask
        else:
            network_input = mask

        model_image = Image.fromarray(network_input.astype(np.uint8) * 255, mode="L").resize(
            (256, 256), Image.Resampling.NEAREST
        )
        tensor = self._torch.from_numpy(np.asarray(model_image, dtype=np.float32) / 255.0)
        tensor = tensor.unsqueeze(0).unsqueeze(0).to(self.device)
        with self._torch.no_grad():
            prediction = self._torch.sigmoid(self.model(tensor))[0, 0].cpu().numpy()
        predicted = Image.fromarray((prediction * 255).astype(np.uint8), mode="L").resize(
            (network_input.shape[1], network_input.shape[0]), Image.Resampling.BILINEAR
        )
        predicted_mask = np.asarray(predicted) > 127
        # Never delete strokes supplied by the user.
        predicted_mask |= network_input

        output = np.empty((*predicted_mask.shape, 3), dtype=np.uint8)
        output[:] = np.clip(background, 0, 255).astype(np.uint8)
        output[predicted_mask] = np.clip(ink, 0, 255).astype(np.uint8)
        return Image.fromarray(output, mode="RGB")
