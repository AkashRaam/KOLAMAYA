"""Compact PyTorch U-Net for experimental kolam completion.

The model maps a one-channel partial ink mask to a one-channel completed ink
mask. It is intentionally separated from the deterministic production engine.
"""
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as functional
except ImportError as exc:  # Gives a clear error when only core requirements are installed.
    raise ImportError("Install requirements-ml.txt to use the U-Net extension.") from exc


class DoubleConv(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, value):
        return self.block(value)


class Down(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.block = nn.Sequential(nn.MaxPool2d(2), DoubleConv(in_channels, out_channels))

    def forward(self, value):
        return self.block(value)


class Up(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.up = nn.ConvTranspose2d(in_channels, in_channels // 2, kernel_size=2, stride=2)
        self.conv = DoubleConv(in_channels, out_channels)

    def forward(self, decoder_value, encoder_value):
        decoder_value = self.up(decoder_value)
        difference_y = encoder_value.size(2) - decoder_value.size(2)
        difference_x = encoder_value.size(3) - decoder_value.size(3)
        decoder_value = functional.pad(
            decoder_value,
            [difference_x // 2, difference_x - difference_x // 2,
             difference_y // 2, difference_y - difference_y // 2],
        )
        return self.conv(torch.cat([encoder_value, decoder_value], dim=1))


class KolamayaUNet(nn.Module):
    """Four-level U-Net; about 7.8M parameters with base width 32."""

    def __init__(self, in_channels=1, out_channels=1, base=32):
        super().__init__()
        self.input = DoubleConv(in_channels, base)
        self.down1 = Down(base, base * 2)
        self.down2 = Down(base * 2, base * 4)
        self.down3 = Down(base * 4, base * 8)
        self.down4 = Down(base * 8, base * 16)
        self.up1 = Up(base * 16, base * 8)
        self.up2 = Up(base * 8, base * 4)
        self.up3 = Up(base * 4, base * 2)
        self.up4 = Up(base * 2, base)
        self.output = nn.Conv2d(base, out_channels, kernel_size=1)

    def forward(self, value):
        x1 = self.input(value)
        x2 = self.down1(x1)
        x3 = self.down2(x2)
        x4 = self.down3(x3)
        x5 = self.down4(x4)
        value = self.up1(x5, x4)
        value = self.up2(value, x3)
        value = self.up3(value, x2)
        value = self.up4(value, x1)
        return self.output(value)
