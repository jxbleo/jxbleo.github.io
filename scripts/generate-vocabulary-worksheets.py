#!/usr/bin/env python3
"""Generate student vocabulary worksheet PDFs from public vocabulary JSON."""

from __future__ import annotations

import argparse
import html
import json
import re
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = 18 * mm
RIGHT = PAGE_WIDTH - 18 * mm
TOP = PAGE_HEIGHT - 18 * mm
BOTTOM = 18 * mm
CONTENT_WIDTH = RIGHT - LEFT
RULE = colors.HexColor("#111827")
MUTED = colors.HexColor("#4b5563")
SOFT_LINE = colors.HexColor("#d1d5db")
PALE_FILL = colors.HexColor("#f8fafc")
LOGO_PATH = PROJECT_ROOT / "assets" / "logos" / "dse-logo.png"
_LOGO_IMAGE = None


def register_fonts() -> None:
    # Keep the worksheet PDF font stack simple and embedded through standard
    # PDF fonts so the student download renders consistently across viewers.
    return None


def logo_image():
    global _LOGO_IMAGE
    if _LOGO_IMAGE is not None:
        return _LOGO_IMAGE
    if not LOGO_PATH.exists():
        return None

    try:
        from PIL import Image

        image = Image.open(LOGO_PATH)
        image.thumbnail((380, 240), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        buffer.seek(0)
        _LOGO_IMAGE = ImageReader(buffer)
    except Exception:
        _LOGO_IMAGE = str(LOGO_PATH)
    return _LOGO_IMAGE


def load_unit(set_id: str) -> dict:
    path = PROJECT_ROOT / "content" / "vocabulary" / f"{set_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing vocabulary unit: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def group_index(unit: dict, group: dict) -> int:
    return (unit.get("quizGroups") or []).index(group) + 1


def group_title(unit: dict, group: dict) -> str:
    index = group_index(unit, group)
    start = group.get("rangeStart")
    end = group.get("rangeEnd")
    return f"Set {index} - Words {start}-{end}"


def normalize_prompt(prompt: str) -> str:
    text = str(prompt or "")
    text = re.sub(r"_{5,}", "______________", text)
    return text


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text), style)


def paragraph_markup(markup: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(markup, style)


def draw_header(c: canvas.Canvas, unit: dict, subtitle: str) -> None:
    c.saveState()
    title = f"{unit.get('id', '')} Worksheet"
    c.setFont("Times-Bold", 15)
    c.setFillColor(RULE)
    c.drawCentredString(PAGE_WIDTH / 2, TOP - 6, title)
    if subtitle:
        c.setFont("Times-Roman", 8.5)
        c.setFillColor(MUTED)
        c.drawCentredString(PAGE_WIDTH / 2, TOP - 20, subtitle)

    logo = logo_image()
    if logo:
        c.drawImage(logo, RIGHT - 34 * mm, TOP - 20, width=30 * mm, height=18.4 * mm, preserveAspectRatio=True, mask="auto")
    else:
        c.setFont("Times-Bold", 12)
        c.drawRightString(RIGHT, TOP - 10, "Mr. Cat Academy")

    c.setStrokeColor(RULE)
    c.setLineWidth(0.7)
    c.line(LEFT, TOP - 32, RIGHT, TOP - 32)
    c.restoreState()


def draw_footer(c: canvas.Canvas, page_number: int) -> None:
    c.saveState()
    c.setFont("Times-Roman", 9)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_WIDTH / 2, BOTTOM - 8, str(page_number))
    c.restoreState()


class WorksheetPdf:
    def __init__(self, output_path: Path, unit: dict, subtitle: str):
        self.output_path = output_path
        self.unit = unit
        self.subtitle = subtitle
        self.canvas = canvas.Canvas(str(output_path), pagesize=A4)
        self.page_number = 1
        self.y = TOP - 48
        self.question_style = ParagraphStyle(
            "Question",
            fontName="Times-Roman",
            fontSize=10.7,
            leading=15.2,
            textColor=RULE,
        )
        self.bank_style = ParagraphStyle(
            "WordBank",
            fontName="Times-Roman",
            fontSize=10,
            leading=13,
            textColor=RULE,
        )
        self._new_page()

    def _new_page(self) -> None:
        if self.page_number > 1:
            self.canvas.showPage()
        draw_header(self.canvas, self.unit, self.subtitle)
        self.y = TOP - 50

    def page_break(self) -> None:
        draw_footer(self.canvas, self.page_number)
        self.page_number += 1
        self._new_page()

    def ensure_space(self, height: float) -> None:
        if self.y - height < BOTTOM + 18:
            self.page_break()

    def draw_intro(self, group_count: int) -> None:
        c = self.canvas
        c.saveState()
        c.setStrokeColor(RULE)
        c.setFillColor(colors.white)
        c.roundRect(LEFT, self.y - 34, CONTENT_WIDTH, 34, 3, fill=1, stroke=1)
        c.setFont("Times-Bold", 10.5)
        c.setFillColor(RULE)
        c.drawString(LEFT + 10, self.y - 14, "Name: ____________________")
        c.drawString(LEFT + 220, self.y - 14, "Date: ____________________")
        c.setFont("Times-Roman", 9.2)
        c.setFillColor(MUTED)
        c.drawString(LEFT + 10, self.y - 28, f"Choose from each word bank. Write one word in each blank. Sets: {group_count}.")
        c.restoreState()
        self.y -= 48

    def draw_group(self, group: dict, compact: bool = False) -> None:
        questions = group.get("questions") or []
        min_height = 156 if compact else 190
        self.ensure_space(min_height)

        c = self.canvas
        title = group_title(self.unit, group)
        c.saveState()
        c.setStrokeColor(RULE)
        c.setLineWidth(0.7)
        c.setFillColor(colors.white)
        c.roundRect(LEFT, self.y - 24, CONTENT_WIDTH, 24, 3, fill=1, stroke=1)
        c.setFont("Times-Bold", 12)
        c.setFillColor(RULE)
        c.drawString(LEFT + 8, self.y - 16, title)
        c.restoreState()
        self.y -= 32

        words = "  |  ".join(group.get("wordList") or [])
        bank = paragraph_markup(f"<b>Word Bank:</b> {html.escape(words)}", self.bank_style)
        bank_width = CONTENT_WIDTH - 20
        bank_height = bank.wrap(bank_width, 100)[1] + 12
        self.ensure_space(bank_height + 110)
        c.saveState()
        c.setFillColor(PALE_FILL)
        c.setStrokeColor(SOFT_LINE)
        c.roundRect(LEFT + 6, self.y - bank_height, CONTENT_WIDTH - 12, bank_height, 2.5, fill=1, stroke=1)
        c.restoreState()
        bank.drawOn(c, LEFT + 14, self.y - bank_height + 7)
        self.y -= bank_height + 12

        for question in questions:
            prompt = normalize_prompt(question.get("prompt") or "")
            number = str(question.get("number") or "")
            para = paragraph(prompt, self.question_style)
            para_width = CONTENT_WIDTH - 42
            para_height = para.wrap(para_width, 100)[1]
            row_height = max(19, para_height + 4)
            self.ensure_space(row_height + 4)
            c.setFont("Times-Roman", 10.7)
            c.setFillColor(RULE)
            c.drawRightString(LEFT + 26, self.y - 12, f"{number}.")
            para.drawOn(c, LEFT + 34, self.y - para_height - 1)
            self.y -= row_height

        self.y -= 12 if compact else 18

    def save(self) -> None:
        draw_footer(self.canvas, self.page_number)
        self.canvas.save()


def output_dir_for(set_id: str) -> Path:
    return PROJECT_ROOT / "assets" / "pdf" / "vocabulary" / set_id


def render_pdf(unit: dict, groups: list[dict], output_path: Path, subtitle: str, compact: bool) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = WorksheetPdf(output_path, unit, subtitle)
    doc.draw_intro(len(groups))
    for group in groups:
        doc.draw_group(group, compact=compact)
    doc.save()


def group_pdf_name(unit: dict, group: dict) -> str:
    return f"{unit['id']}-set-{group['id']}.pdf"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate vocabulary worksheet PDFs.")
    parser.add_argument("set_id", help="Vocabulary set id, for example NAWL-A")
    args = parser.parse_args()

    register_fonts()
    unit = load_unit(args.set_id)
    groups = unit.get("quizGroups") or []
    if not groups:
        raise ValueError(f"{args.set_id} has no quizGroups")

    out_dir = output_dir_for(unit["id"])
    all_pdf = out_dir / f"{unit['id']}-all-sets.pdf"
    render_pdf(unit, groups, all_pdf, "Complete cloze worksheet", compact=True)

    for group in groups:
        subtitle = f"{group_title(unit, group)} - Cloze worksheet"
        render_pdf(unit, [group], out_dir / group_pdf_name(unit, group), subtitle, compact=False)

    print(f"Generated {1 + len(groups)} PDFs in {out_dir}")


if __name__ == "__main__":
    main()
