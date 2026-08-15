"""Train the optional KOLAMAYA U-Net on paired mask images.

Run from the project root after generating data:
    python -m backend.training.train_unet --epochs 25
"""
import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image
from torch.utils.data import DataLoader, Dataset, random_split

from backend.models.unet import KolamayaUNet


class PairedKolamDataset(Dataset):
    def __init__(self, root):
        self.root = Path(root)
        self.inputs = sorted((self.root / "input").glob("*.png"))
        if not self.inputs:
            raise FileNotFoundError(f"No training images found in {self.root / 'input'}")

    def __len__(self):
        return len(self.inputs)

    def __getitem__(self, index):
        input_path = self.inputs[index]
        target_path = self.root / "target" / input_path.name
        partial = np.asarray(Image.open(input_path).convert("L"), dtype=np.float32) / 255.0
        target = np.asarray(Image.open(target_path).convert("L"), dtype=np.float32) / 255.0
        return torch.from_numpy(partial).unsqueeze(0), torch.from_numpy(target).unsqueeze(0)


def dice_loss(logits, target, epsilon=1e-6):
    probability = torch.sigmoid(logits)
    intersection = (probability * target).sum(dim=(1, 2, 3))
    union = probability.sum(dim=(1, 2, 3)) + target.sum(dim=(1, 2, 3))
    return (1.0 - (2.0 * intersection + epsilon) / (union + epsilon)).mean()


def evaluate(model, loader, device):
    model.eval()
    total = 0.0
    with torch.no_grad():
        for partial, target in loader:
            partial, target = partial.to(device), target.to(device)
            logits = model(partial)
            loss = functional.binary_cross_entropy_with_logits(logits, target) + dice_loss(logits, target)
            total += float(loss.item())
    return total / max(1, len(loader))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/synthetic")
    parser.add_argument("--checkpoint", default="backend/checkpoints/kolamaya_unet.pt")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    dataset = PairedKolamDataset(args.data)
    validation_size = max(1, int(len(dataset) * 0.1))
    training_size = len(dataset) - validation_size
    train_data, validation_data = random_split(
        dataset, [training_size, validation_size], generator=torch.Generator().manual_seed(args.seed)
    )
    train_loader = DataLoader(train_data, batch_size=args.batch_size, shuffle=True, num_workers=0)
    validation_loader = DataLoader(validation_data, batch_size=args.batch_size, num_workers=0)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = KolamayaUNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    best_loss = float("inf")
    checkpoint = Path(args.checkpoint)
    checkpoint.parent.mkdir(parents=True, exist_ok=True)

    print(f"Training on {device}; {training_size} train / {validation_size} validation samples")
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        for partial, target in train_loader:
            partial, target = partial.to(device), target.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(partial)
            loss = functional.binary_cross_entropy_with_logits(logits, target) + dice_loss(logits, target)
            loss.backward()
            optimizer.step()
            train_loss += float(loss.item())

        train_loss /= max(1, len(train_loader))
        validation_loss = evaluate(model, validation_loader, device)
        print(f"Epoch {epoch:03d} | train {train_loss:.4f} | validation {validation_loss:.4f}")
        if validation_loss < best_loss:
            best_loss = validation_loss
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "epoch": epoch,
                    "validation_loss": validation_loss,
                    "architecture": "KolamayaUNet(base=32)",
                    "input_size": 256,
                },
                checkpoint,
            )
            print(f"  Saved best checkpoint to {checkpoint}")


if __name__ == "__main__":
    main()
