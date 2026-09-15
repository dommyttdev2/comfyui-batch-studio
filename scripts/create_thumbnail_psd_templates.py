"""Create layered PSD thumbnail templates for the four supported split patterns."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from psd_tools import PSDImage


WIDTH = 1600
HEIGHT = 1200
LINE_WIDTH = 22
WHITE = (255, 255, 255, 255)

# Main fan boundaries: wide at the top, narrow at the bottom.
LEFT_TOP_X = 320
LEFT_BOTTOM_X = 560
RIGHT_TOP_X = 1280
RIGHT_BOTTOM_X = 1040
SIDE_SPLIT_OUTER_Y = 490
SIDE_SPLIT_INNER_Y = 590


PATTERNS = {
    "3-images": "3枚",
    "4-images-left-split": "4枚（左を上下分割）",
    "4-images-right-split": "4枚（右を上下分割）",
    "5-images-both-split": "5枚（左右を上下分割）",
}


def boundary_x(top_x: int, bottom_x: int, y: int) -> int:
    return round(top_x + (bottom_x - top_x) * (y / HEIGHT))


LEFT_MID_X = boundary_x(LEFT_TOP_X, LEFT_BOTTOM_X, SIDE_SPLIT_INNER_Y)
RIGHT_MID_X = boundary_x(RIGHT_TOP_X, RIGHT_BOTTOM_X, SIDE_SPLIT_INNER_Y)


def get_font(size: int) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def get_serif_font(size: int) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/times.ttf"),
        Path("C:/Windows/Fonts/YuMin-M.ttc"),
        Path("C:/Windows/Fonts/meiryo.ttc"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def make_placeholder(label: str, colors: tuple[tuple[int, int, int], tuple[int, int, int]]) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT))
    pixels = image.load()
    start, end = colors
    for y in range(HEIGHT):
        ratio = y / max(1, HEIGHT - 1)
        color = tuple(round(start[i] * (1 - ratio) + end[i] * ratio) for i in range(3))
        for x in range(WIDTH):
            pixels[x, y] = color

    draw = ImageDraw.Draw(image, "RGBA")
    # Subtle diagonal texture makes each slot boundary easy to inspect.
    for offset in range(-HEIGHT, WIDTH, 120):
        draw.line((offset, HEIGHT, offset + HEIGHT, 0), fill=(255, 255, 255, 18), width=24)

    return image


def polygon_mask(points: list[tuple[int, int]]) -> Image.Image:
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def get_slots(pattern: str) -> list[tuple[str, list[tuple[int, int]], tuple[tuple[int, int, int], tuple[int, int, int]]]]:
    left_full = [(0, 0), (LEFT_TOP_X, 0), (LEFT_BOTTOM_X, HEIGHT), (0, HEIGHT)]
    center = [
        (LEFT_TOP_X, 0),
        (RIGHT_TOP_X, 0),
        (RIGHT_BOTTOM_X, HEIGHT),
        (LEFT_BOTTOM_X, HEIGHT),
    ]
    right_full = [(RIGHT_TOP_X, 0), (WIDTH, 0), (WIDTH, HEIGHT), (RIGHT_BOTTOM_X, HEIGHT)]

    left_upper = [
        (0, 0),
        (LEFT_TOP_X, 0),
        (LEFT_MID_X, SIDE_SPLIT_INNER_Y),
        (0, SIDE_SPLIT_OUTER_Y),
    ]
    left_lower = [
        (0, SIDE_SPLIT_OUTER_Y),
        (LEFT_MID_X, SIDE_SPLIT_INNER_Y),
        (LEFT_BOTTOM_X, HEIGHT),
        (0, HEIGHT),
    ]
    right_upper = [
        (RIGHT_TOP_X, 0),
        (WIDTH, 0),
        (WIDTH, SIDE_SPLIT_OUTER_Y),
        (RIGHT_MID_X, SIDE_SPLIT_INNER_Y),
    ]
    right_lower = [
        (RIGHT_MID_X, SIDE_SPLIT_INNER_Y),
        (WIDTH, SIDE_SPLIT_OUTER_Y),
        (WIDTH, HEIGHT),
        (RIGHT_BOTTOM_X, HEIGHT),
    ]

    colors = {
        "left": ((72, 43, 78), (31, 17, 44)),
        "left_upper": ((102, 57, 83), (48, 23, 52)),
        "left_lower": ((76, 41, 92), (28, 19, 51)),
        "center": ((126, 45, 62), (47, 14, 29)),
        "right": ((83, 52, 73), (27, 19, 39)),
        "right_upper": ((103, 62, 74), (45, 26, 43)),
        "right_lower": ((73, 46, 88), (25, 18, 48)),
    }

    slots: list[tuple[str, list[tuple[int, int]], tuple[tuple[int, int, int], tuple[int, int, int]]]] = []
    if pattern in {"4-images-left-split", "5-images-both-split"}:
        slots.extend(
            [
                ("LEFT_TOP", left_upper, colors["left_upper"]),
                ("LEFT_BOTTOM", left_lower, colors["left_lower"]),
            ]
        )
    else:
        slots.append(("LEFT", left_full, colors["left"]))

    slots.append(("CENTER_MAIN", center, colors["center"]))

    if pattern in {"4-images-right-split", "5-images-both-split"}:
        slots.extend(
            [
                ("RIGHT_TOP", right_upper, colors["right_upper"]),
                ("RIGHT_BOTTOM", right_lower, colors["right_lower"]),
            ]
        )
    else:
        slots.append(("RIGHT", right_full, colors["right"]))
    return slots


def make_separator_layer(pattern: str) -> Image.Image:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.line((LEFT_TOP_X, 0, LEFT_BOTTOM_X, HEIGHT), fill=WHITE, width=LINE_WIDTH)
    draw.line((RIGHT_TOP_X, 0, RIGHT_BOTTOM_X, HEIGHT), fill=WHITE, width=LINE_WIDTH)
    if pattern in {"4-images-left-split", "5-images-both-split"}:
        draw.line((0, SIDE_SPLIT_OUTER_Y, LEFT_MID_X, SIDE_SPLIT_INNER_Y), fill=WHITE, width=LINE_WIDTH)
    if pattern in {"4-images-right-split", "5-images-both-split"}:
        draw.line((RIGHT_MID_X, SIDE_SPLIT_INNER_Y, WIDTH, SIDE_SPLIT_OUTER_Y), fill=WHITE, width=LINE_WIDTH)
    return overlay


def make_bottom_gradient() -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    pixels = image.load()
    start_y = round(HEIGHT * 0.67)
    for y in range(start_y, HEIGHT):
        ratio = (y - start_y) / max(1, HEIGHT - start_y - 1)
        # Ease in gently, then reach the strong dark base seen in the samples.
        alpha = round(220 * (ratio**1.35))
        for x in range(WIDTH):
            pixels[x, y] = (3, 6, 14, alpha)
    return image


def make_title_layer(text: str = "Scene 01") -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.text(
        (WIDTH // 2, 985),
        text,
        font=get_serif_font(154),
        fill=(255, 255, 255, 255),
        stroke_width=3,
        stroke_fill=(0, 0, 0, 125),
        anchor="mm",
    )
    return image


def make_subtitle_layer(text: str = "Midnight Elegance") -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = get_serif_font(50)
    center_x = WIDTH // 2
    center_y = 1100
    draw.text(
        (center_x, center_y),
        text,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=1,
        stroke_fill=(0, 0, 0, 110),
        anchor="mm",
    )
    return image


def make_subtitle_rules_layer(text: str = "Midnight Elegance") -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = get_serif_font(50)
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    center_x = WIDTH // 2
    center_y = 1100
    gap = 40
    line_length = 175
    left_text = center_x - text_width // 2
    right_text = center_x + text_width // 2
    draw.line((left_text - gap - line_length, center_y, left_text - gap, center_y), fill=WHITE, width=3)
    draw.line((right_text + gap, center_y, right_text + gap + line_length, center_y), fill=WHITE, width=3)
    return image


def make_text_guide() -> Image.Image:
    guide = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(guide)
    guide_color = (0, 220, 255, 210)
    box = (250, 850, 1350, 1150)
    dash = 24
    for x in range(box[0], box[2], dash * 2):
        draw.line((x, box[1], min(x + dash, box[2]), box[1]), fill=guide_color, width=3)
        draw.line((x, box[3], min(x + dash, box[2]), box[3]), fill=guide_color, width=3)
    for y in range(box[1], box[3], dash * 2):
        draw.line((box[0], y, box[0], min(y + dash, box[3])), fill=guide_color, width=3)
        draw.line((box[2], y, box[2], min(y + dash, box[3])), fill=guide_color, width=3)
    draw.text((WIDTH // 2, 1000), "TEXT SAFE AREA", font=get_font(42), fill=guide_color, anchor="mm")
    return guide


def build_template(pattern: str, output_dir: Path) -> tuple[Path, Path]:
    psd = PSDImage.new(mode="RGB", size=(WIDTH, HEIGHT), depth=8, color=(12, 12, 16))

    background = Image.new("RGB", (WIDTH, HEIGHT), (12, 12, 16))
    psd.create_pixel_layer(background, name="00_BACKGROUND")

    slot_group = psd.create_group(name="01_IMAGE_SLOTS__REPLACE_CONTENT_KEEP_MASKS")
    for label, points, colors in get_slots(pattern):
        item_group = psd.create_group(name=f"SLOT_{label}")
        slot_group.append(item_group)
        layer = psd.create_pixel_layer(
            make_placeholder(label, colors),
            name=f"REPLACE_IMAGE__{label}__DROP_NEW_IMAGE_IN_THIS_FOLDER",
        )
        # Create a valid temporary pixel-layer mask. The post-processing step
        # moves this mask to SLOT_* so every image in that folder is clipped.
        layer.create_mask(polygon_mask(points))
        item_group.append(layer)

    psd.create_pixel_layer(make_separator_layer(pattern), name="02_DIVIDERS__WHITE_22PX")
    psd.create_pixel_layer(make_bottom_gradient(), name="03_BOTTOM_GRADIENT__ABOVE_DIVIDERS")
    text_group = psd.create_group(name="04_TEXT__EDITABLE")
    title = psd.create_pixel_layer(make_title_layer(), name="TITLE__EDIT_TEXT")
    text_group.append(title)
    subtitle = psd.create_pixel_layer(make_subtitle_layer(), name="SUBTITLE__EDIT_TEXT")
    text_group.append(subtitle)
    rules = psd.create_pixel_layer(make_subtitle_rules_layer(), name="SUBTITLE_RULES__DECORATION")
    text_group.append(rules)
    guide = psd.create_pixel_layer(make_text_guide(), name="05_TEXT_SAFE_AREA__HIDDEN")
    guide.visible = False

    psd_path = output_dir / f"thumbnail-template-{pattern}.psd"
    preview_path = output_dir / f"thumbnail-template-{pattern}-preview.png"
    psd.save(psd_path, encoding="utf-8")

    reopened = PSDImage.open(psd_path)
    if reopened.size != (WIDTH, HEIGHT):
        raise RuntimeError(f"Unexpected PSD size for {psd_path}: {reopened.size}")
    reopened.composite().convert("RGB").save(preview_path, quality=95)
    return psd_path, preview_path


def write_readme(output_dir: Path) -> None:
    readme = """# サムネイルPSDテンプレート

- キャンバス: 1600 x 1200 px（横長 4:3）
- 分割線: 白、22 px。下部はグラデーションにより自然に暗くなります。
- 中央パネル: 常に1枚。上側約60%、下側約30%の幅で緩やかに収束します。
- 左右の上下分割線: 外側から中央へ向かって下がる斜線です。
- 下部: テキストを画像上へ載せるための半透明グラデーションです。

## 画像の差し替え

1. `01_IMAGE_SLOTS__REPLACE_CONTENT_KEEP_MASKS` を開きます。
2. 素材画像を対象の `SLOT_*` フォルダ内へ配置します。
3. マスクは各 `SLOT_*` フォルダ自体に付いているため、中の画像は自動的に領域内へ収まります。
4. 素材画像を移動・拡大縮小して構図を調整し、古い `REPLACE_IMAGE__*` を非表示または削除します。
5. テキストは `04_TEXT__EDITABLE` 内の `TITLE__EDIT_TEXT` と `SUBTITLE__EDIT_TEXT` を編集します。

タイトルとサブタイトルは編集可能な文字レイヤーとして書き出されます。

`05_TEXT_SAFE_AREA__HIDDEN` は必要なときだけ表示してください。
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for pattern in PATTERNS:
        psd_path, preview_path = build_template(pattern, args.output_dir)
        print(f"created: {psd_path}")
        print(f"preview: {preview_path}")
    write_readme(args.output_dir)


if __name__ == "__main__":
    main()
