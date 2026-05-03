"""
Generate all required brand asset sizes from the master logo.

Source:  docs/designs/ComfyUI AI Studio Logo.png
Outputs:
  app/favicon.ico            (16/32/48 stacked)
  app/icon.png               (256)
  app/apple-icon.png         (180)
  app/opengraph-image.png    (1200x630, logo on dark panel bg)
  app/twitter-image.png      (1200x600, logo on dark panel bg)
  public/brand/logo-64.png   (sidebar @ 1x/2x)
  public/brand/logo-128.png  (sidebar / inline @ 3x, generic UI)
  public/brand/logo-256.png  (anywhere larger)

Run with:  python scripts/generate-brand-assets.py
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "designs" / "ComfyUI AI Studio Logo.png"

# Dark panel-elevated bg for social cards — matches `--color-panel-elevated` token.
SOCIAL_BG = (38, 38, 47, 255)  # ~#26262F


def load_squared_source() -> Image.Image:
    """Load the source, trim any transparent gutter, and square-pad to the long side."""
    if not SRC.exists():
        raise FileNotFoundError(f"Source logo not found at {SRC}")
    img = Image.open(SRC).convert("RGBA")

    bbox = img.getbbox()
    if bbox is not None:
        img = img.crop(bbox)

    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


def resize_square(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def write_favicon(square: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    sizes = [(16, 16), (32, 32), (48, 48)]
    base = resize_square(square, 48)
    base.save(dest, format="ICO", sizes=sizes)
    print(f"  wrote {dest.relative_to(ROOT)} ({', '.join(f'{w}x{h}' for w, h in sizes)})")


def write_png(img: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG", optimize=True)
    print(f"  wrote {dest.relative_to(ROOT)} ({img.size[0]}x{img.size[1]})")


def make_social(square: Image.Image, width: int, height: int) -> Image.Image:
    """Composite the squared logo onto a dark canvas of the requested aspect."""
    canvas = Image.new("RGBA", (width, height), SOCIAL_BG)
    target_h = int(height * 0.78)
    ratio = target_h / square.size[1]
    target_w = int(square.size[0] * ratio)
    logo = square.resize((target_w, target_h), Image.LANCZOS)
    canvas.paste(logo, ((width - target_w) // 2, (height - target_h) // 2), logo)
    return canvas.convert("RGB")


def main() -> None:
    print(f"Source: {SRC.relative_to(ROOT)}")
    square = load_squared_source()
    print(f"Squared source: {square.size[0]}x{square.size[1]}")
    print()

    # App router icon files (Next.js auto-detects)
    write_favicon(square, ROOT / "app" / "favicon.ico")
    write_png(resize_square(square, 256), ROOT / "app" / "icon.png")
    write_png(resize_square(square, 180), ROOT / "app" / "apple-icon.png")

    # Social cards (dark bg)
    write_png(make_social(square, 1200, 630), ROOT / "app" / "opengraph-image.png")
    write_png(make_social(square, 1200, 600), ROOT / "app" / "twitter-image.png")

    # In-app brand assets
    for size in (64, 128, 256):
        write_png(resize_square(square, size), ROOT / "public" / "brand" / f"logo-{size}.png")

    print()
    print("Done.")


if __name__ == "__main__":
    main()
