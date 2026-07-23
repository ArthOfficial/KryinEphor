from __future__ import annotations

import math
import shutil
import sys
import wave
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
FRAMES = ROOT / "frames"
NARRATION = ROOT / "audio" / "narration.wav"

WIDTH, HEIGHT, FPS = 1920, 1080, 6
INK = (247, 247, 243)
MUTED = (174, 185, 180)
EMERALD = (29, 201, 159)
LIME = (208, 255, 116)
CORAL = (255, 93, 125)


@dataclass(frozen=True)
class Scene:
    key: str
    weight: int
    eyebrow: str
    title: str
    caption: str
    images: tuple[str, ...]
    kind: str = "product"


SCENES = (
    Scene("01", 9, "KRYIN EPHOR", "The operating system\nfor modern schools.", "One platform for every school role.", ("02-homepage-hero.png",), "hero"),
    Scene("02", 8, "ONE CONNECTED CANVAS", "People. Academics.\nOperations.", "Stop stitching together disconnected school tools.", ("01-homepage-full.png",), "product"),
    Scene("03", 10, "PLATFORM CONTROL", "See every school\nwithout losing detail.", "Super Admin: tenants, system health, schools, and revenue.", ("03-superadmin-dashboard.png", "04-superadmin-database.png")),
    Scene("04", 12, "SCHOOL OPERATIONS", "The whole school\nin one workspace.", "Manage users, permissions, classes, and daily operations.", ("05-admin-dashboard.png", "06-user-management.png", "07-class-management.png")),
    Scene("05", 8, "SMART ATTENDANCE", "A daily loop\nthat stays visible.", "Track present, absent, and late students at a glance.", ("08-attendance-management.png",)),
    Scene("06", 8, "FINANCE IN CONTEXT", "Fee plans to payroll,\nconnected.", "Collection, invoices, receipts, and salary in the same system.", ("09-school-finance.png",)),
    Scene("07", 10, "STUDENT EXPERIENCE", "Progress that feels\npersonal.", "A clear dashboard, upcoming tests, and learning visibility.", ("10-student-dashboard.png", "11-student-tests.png")),
    Scene("08", 8, "FOCUS MODE", "One task.\nFully present.", "A calm, customizable space for deep student focus.", ("12-focus-mode.png", "13-focus-mode-settings.png"), "focus"),
    Scene("09", 10, "BUILT FOR TRUST", "Multi-tenant\nby design.", "54 tables · 211 RLS policies · 7 role-specific experiences.", (), "architecture"),
    Scene("10", 11, "HOW WE BUILT", "Codex + GPT-5.6\nas collaborators.", "From product requirements to role-based flows and rapid iteration.", (), "build"),
    Scene("11", 8, "WHAT'S NEXT", "The school of\ntomorrow.", "Parent portal · mobile workflows · analytics · exports · communication.", (), "future"),
    Scene("12", 7, "KRYIN EPHOR", "One intelligent system.\nEvery school role.", "Built for modern education.", (), "outro"),
)


def font(size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
    if italic:
        filename = "segoeuii.ttf"
    elif bold:
        filename = "segoeuib.ttf"
    else:
        filename = "segoeui.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / filename), size)


def narration_seconds() -> float:
    if not NARRATION.exists():
        return 85.0
    with wave.open(str(NARRATION), "rb") as audio:
        return audio.getnframes() / audio.getframerate()


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    x = (resized.width - size[0]) // 2
    y = (resized.height - size[1]) // 2
    return resized.crop((x, y, x + size[0], y + size[1]))


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = min(size[0] / image.width, size[1] / image.height)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)


def eased(value: float) -> float:
    return value * value * (3 - 2 * value)


def alpha_composite(base: Image.Image, overlay: Image.Image, xy: tuple[int, int]) -> None:
    base.alpha_composite(overlay, xy)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def text_block(draw: ImageDraw.ImageDraw, text: str, x: int, y: int, size: int, fill: tuple[int, int, int], max_width: int, leading: int = 10) -> int:
    active_font = font(size, bold=True)
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else current + " " + word
        if draw.textbbox((0, 0), candidate, font=active_font)[2] <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    line_height = size + leading
    for index, line in enumerate(lines):
        draw.text((x, y + index * line_height), line, font=active_font, fill=fill)
    return y + len(lines) * line_height


def background(scene: Scene, progress: float) -> Image.Image:
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (4, 8, 7, 255))
    wash = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    wash_draw = ImageDraw.Draw(wash, "RGBA")
    wash_draw.ellipse((820, -550, 2350, 920), fill=(10, 88, 62, 128))
    wash_draw.ellipse((-420, 560, 840, 1560), fill=(50, 93, 39, 48))
    canvas.alpha_composite(wash.filter(ImageFilter.GaussianBlur(120)))

    draw = ImageDraw.Draw(canvas, "RGBA")
    offset = int(progress * 130)
    for x in range(-offset, WIDTH + 160, 160):
        draw.line((x, 0, x, HEIGHT), fill=(180, 255, 227, 16), width=1)
    for y in range(-offset, HEIGHT + 130, 130):
        draw.line((0, y, WIDTH, y), fill=(180, 255, 227, 13), width=1)
    draw.ellipse((WIDTH - 700, -330, WIDTH + 250, 600), outline=(74, 244, 184, 58), width=2)
    draw.ellipse((WIDTH - 510, -140, WIDTH + 70, 430), outline=(208, 255, 116, 42), width=1)
    return canvas


def draw_screen(base: Image.Image, source: Path, box: tuple[int, int, int, int], progress: float, index: int) -> None:
    x, y, width, height = box
    screenshot = Image.open(source).convert("RGBA")
    image = contain(screenshot, (width - 28, height - 28))
    zoom = 1.0 + 0.035 * eased(progress)
    image = image.resize((round(image.width * zoom), round(image.height * zoom)), Image.Resampling.LANCZOS)
    card = Image.new("RGBA", (width, height), (249, 249, 245, 255))
    shadow = Image.new("RGBA", (width + 40, height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((20, 20, width + 12, height + 12), radius=26, fill=(0, 0, 0, 112))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    alpha_composite(base, shadow, (x - 20, y - 4))
    mask = rounded_mask((width, height), 22)
    card.putalpha(mask)
    frame = Image.new("RGBA", (width, height), (246, 246, 242, 255))
    frame.paste(image, ((width - image.width) // 2, (height - image.height) // 2), image)
    frame.putalpha(mask)
    alpha_composite(base, frame, (x, y))
    border = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle((1, 1, width - 2, height - 2), radius=22, outline=(255, 255, 255, 120), width=2)
    alpha_composite(base, border, (x, y))


def draw_product_scene(base: Image.Image, scene: Scene, progress: float) -> None:
    available = [ASSETS / image for image in scene.images]
    active = min(len(available) - 1, int(progress * len(available)))
    if len(available) == 1:
        draw_screen(base, available[0], (740, 190, 1030, 650), progress, 0)
    else:
        primary = available[active]
        secondary = available[(active + 1) % len(available)]
        shift = int(math.sin(progress * math.pi) * 16)
        draw_screen(base, secondary, (1120, 440 + shift, 660, 420), progress, 1)
        draw_screen(base, primary, (650, 165 - shift, 910, 575), progress, 0)


def stat_card(base: Image.Image, x: int, y: int, label: str, value: str, accent: tuple[int, int, int], progress: float) -> None:
    panel = Image.new("RGBA", (300, 210), (12, 25, 22, 238))
    panel_draw = ImageDraw.Draw(panel, "RGBA")
    panel_draw.rounded_rectangle((0, 0, 299, 209), radius=24, outline=accent + (125,), width=2)
    panel_draw.ellipse((26, 28, 46, 48), fill=accent + (255,))
    panel_draw.text((26, 76), value, font=font(54, bold=True), fill=INK)
    panel_draw.text((28, 144), label, font=font(17, bold=True), fill=MUTED)
    alpha = int(255 * min(1.0, max(0.0, progress * 1.8)))
    panel.putalpha(panel.getchannel("A").point(lambda value: value * alpha // 255))
    alpha_composite(base, panel, (x, y))


def draw_architecture(base: Image.Image, scene: Scene, progress: float) -> None:
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rounded_rectangle((735, 210, 1685, 780), radius=42, fill=(10, 24, 21, 226), outline=(75, 250, 192, 105), width=2)
    draw.text((800, 270), "A secure shared foundation", font=font(43, bold=True), fill=INK)
    draw.text((802, 338), "Each role sees exactly the workspace it needs.", font=font(24), fill=MUTED)
    stat_card(base, 790, 435, "DATA TABLES", "54", EMERALD, progress)
    stat_card(base, 1120, 435, "RLS POLICIES", "211", LIME, progress)
    stat_card(base, 1450, 435, "ROLE FLOWS", "7", CORAL, progress)


def draw_build(base: Image.Image, scene: Scene, progress: float) -> None:
    draw = ImageDraw.Draw(base, "RGBA")
    panel = (735, 185, 1715, 795)
    draw.rounded_rectangle(panel, radius=42, fill=(10, 22, 20, 235), outline=(64, 227, 174, 125), width=2)
    draw.text((800, 250), "PROMPT → PRODUCT → ITERATION", font=font(22, bold=True), fill=EMERALD)
    draw.text((800, 304), "Codex + GPT-5.6", font=font(62, bold=True), fill=INK)
    items = (
        ("01", "Translate requirements", "Turn school workflows into clear, buildable UI tasks."),
        ("02", "Shape role-specific flows", "Keep platform, admin, and student experiences distinct."),
        ("03", "Iterate with product context", "Refine components, interfaces, and implementation details."),
    )
    for index, (number, title, body) in enumerate(items):
        y = 430 + index * 105
        draw.ellipse((805, y, 850, y + 45), fill=(26, 81, 66, 255))
        draw.text((817, y + 9), number, font=font(15, bold=True), fill=INK)
        draw.text((875, y), title, font=font(26, bold=True), fill=INK)
        draw.text((875, y + 38), body, font=font(18), fill=MUTED)


def draw_future(base: Image.Image, scene: Scene, progress: float) -> None:
    draw = ImageDraw.Draw(base, "RGBA")
    items = ("Parent portal", "Mobile workflows", "Advanced analytics", "Exports", "School communication")
    for index, item in enumerate(items):
        x = 735 + (index % 2) * 380
        y = 270 + (index // 2) * 140
        panel = Image.new("RGBA", (340, 104), (15, 34, 29, 236))
        panel_draw = ImageDraw.Draw(panel, "RGBA")
        panel_draw.rounded_rectangle((0, 0, 339, 103), radius=20, outline=(143, 255, 213, 92), width=1)
        panel_draw.text((24, 34), item, font=font(22, bold=True), fill=INK)
        alpha_composite(base, panel, (x, y))


def draw_outro(base: Image.Image, progress: float) -> None:
    draw = ImageDraw.Draw(base, "RGBA")
    radius = int(170 + 45 * eased(progress))
    draw.ellipse((1260 - radius, 500 - radius, 1260 + radius, 500 + radius), outline=(132, 255, 207, 80), width=2)
    draw.ellipse((1260 - radius * 0.68, 500 - radius * 0.68, 1260 + radius * 0.68, 500 + radius * 0.68), outline=(208, 255, 116, 105), width=2)
    draw.text((755, 730), "Designed for modern education.", font=font(23), fill=MUTED)


def render_frame(scene: Scene, progress: float, frame_index: int, frame_total: int) -> Image.Image:
    frame = background(scene, progress)
    if scene.kind in {"hero", "product", "focus"}:
        draw_product_scene(frame, scene, progress)
    elif scene.kind == "architecture":
        draw_architecture(frame, scene, progress)
    elif scene.kind == "build":
        draw_build(frame, scene, progress)
    elif scene.kind == "future":
        draw_future(frame, scene, progress)
    elif scene.kind == "outro":
        draw_outro(frame, progress)

    draw = ImageDraw.Draw(frame, "RGBA")
    draw.rectangle((92, 127, 150, 132), fill=EMERALD + (255,))
    draw.text((92, 160), scene.eyebrow, font=font(19, bold=True), fill=EMERALD)
    y = 215
    for line in scene.title.split("\n"):
        draw.text((90, y), line, font=font(64, bold=True), fill=INK)
        y += 74
    draw.rounded_rectangle((90, 860, 690, 944), radius=18, fill=(8, 17, 15, 215), outline=(133, 242, 204, 72), width=1)
    draw.text((120, 886), scene.caption, font=font(17, bold=True), fill=(225, 232, 226))
    draw.text((90, 1004), "KRYIN EPHOR  /  HACKATHON DEMO", font=font(15, bold=True), fill=(118, 141, 132))
    draw.text((1680, 1004), f"{frame_index + 1:03d}/{frame_total:03d}", font=font(15, bold=True), fill=(118, 141, 132))
    return frame.convert("RGB")


def scene_frame_counts(total_frames: int) -> list[int]:
    total_weight = sum(scene.weight for scene in SCENES)
    raw = [scene.weight * total_frames / total_weight for scene in SCENES]
    counts = [max(1, int(value)) for value in raw]
    while sum(counts) < total_frames:
        index = max(range(len(raw)), key=lambda i: raw[i] - counts[i])
        counts[index] += 1
    while sum(counts) > total_frames:
        index = max(range(len(raw)), key=lambda i: counts[i])
        counts[index] -= 1
    return counts


def main() -> None:
    duration = max(72.0, narration_seconds() + 1.2)
    target_frames = math.ceil(duration * FPS)
    if FRAMES.exists():
        for file in FRAMES.glob("*.jpg"):
            file.unlink()
    else:
        FRAMES.mkdir(parents=True)

    counts = scene_frame_counts(target_frames)
    index = 0
    for scene, count in zip(SCENES, counts):
        for local_index in range(count):
            progress = 0.0 if count == 1 else local_index / (count - 1)
            image = render_frame(scene, progress, index, target_frames)
            image.save(FRAMES / f"frame-{index:04d}.jpg", quality=92, subsampling=0, optimize=True)
            index += 1
        print(f"{scene.key}: {count} frames")
    print(f"Generated {index} frames at {FPS} fps for {index / FPS:.1f} seconds.")


if __name__ == "__main__":
    main()
