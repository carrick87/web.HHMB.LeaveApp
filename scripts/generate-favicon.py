"""Generate favicon assets from public/appstore.png (your brand logo)."""
from __future__ import annotations

import base64
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "appstore.png"


def crop_to_logo(image: Image.Image) -> Image.Image:
    pixels = image.load()
    width, height = image.size
    min_x, min_y, max_x, max_y = width, height, 0, 0

    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 10 and not (red > 240 and green > 240 and blue > 240):
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)

    margin = 2
    min_x = max(0, min_x - margin)
    min_y = max(0, min_y - margin)
    max_x = min(width - 1, max_x + margin)
    max_y = min(height - 1, max_y + margin)
    cropped = image.crop((min_x, min_y, max_x + 1, max_y + 1))

    crop_width, crop_height = cropped.size
    side = max(crop_width, crop_height)
    square = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    square.paste(cropped, ((side - crop_width) // 2, (side - crop_height) // 2), cropped)
    return square


def write_svg_favicon(path: Path, png_path: Path) -> None:
    encoded = base64.b64encode(png_path.read_bytes()).decode("ascii")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" '
        'aria-label="LeaveApp">\n'
        f'  <image href="data:image/png;base64,{encoded}" width="48" height="48"/>\n'
        "</svg>\n"
    )
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    square = crop_to_logo(image)

    for size in (16, 32, 48, 180):
        resized = square.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(PUBLIC / f"favicon-{size}x{size}.png")

    icon_16 = square.resize((16, 16), Image.Resampling.LANCZOS)
    icon_32 = square.resize((32, 32), Image.Resampling.LANCZOS)
    icon_48 = square.resize((48, 48), Image.Resampling.LANCZOS)
    icon_16.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    square.resize((180, 180), Image.Resampling.LANCZOS).save(PUBLIC / "apple-touch-icon.png")

    favicon_48 = PUBLIC / "favicon-48x48.png"
    write_svg_favicon(PUBLIC / "favicon.svg", favicon_48)
    print("Favicon assets written to", PUBLIC)


if __name__ == "__main__":
    main()
