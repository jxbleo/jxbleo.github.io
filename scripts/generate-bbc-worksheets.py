#!/usr/bin/env python3
"""Generate no-answer BBC worksheet PDFs from public runtime JSON."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PAGE_WIDTH, PAGE_HEIGHT = A4

FRAME_X = 15 * mm
FRAME_Y = 14 * mm
FRAME_WIDTH = PAGE_WIDTH - 30 * mm
FRAME_HEIGHT = PAGE_HEIGHT - 28 * mm

CONTENT_X = 23 * mm
CONTENT_WIDTH = PAGE_WIDTH - 46 * mm
TOP_Y = PAGE_HEIGHT - 25 * mm
BOTTOM_Y = 31 * mm

RULE = colors.HexColor("#000000")
NUMBER_COLUMN_WIDTH = 11 * mm


def normalize_text(value: str) -> str:
    text = html.unescape(str(value or ""))
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2026": "...",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"<\s*br\s*/?\s*>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def remove_fill_number(text: str, number: int) -> str:
    return re.sub(rf"\s*\(\s*{number}\s*\)\s*$", "", text).strip()


def lengthen_fill_blanks(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        return "_" * max(len(match.group(0)) + 1, round(len(match.group(0)) * 1.5))

    return re.sub(r"_{3,}", repl, text)


def strip_option_prefix(option: str, letter: str) -> str:
    return re.sub(rf"^\s*{re.escape(letter)}[\.\)]\s+", "", option, flags=re.IGNORECASE)


def paragraph(markup: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(markup, style)


def draw_page_frame(c: canvas.Canvas, page_number: int) -> None:
    c.saveState()
    c.setStrokeColor(RULE)
    c.setFillColor(RULE)
    c.setLineWidth(0.75)
    c.rect(FRAME_X, FRAME_Y, FRAME_WIDTH, FRAME_HEIGHT)

    note = "Answers written in the margins will not be marked."
    c.setFont("Times-Roman", 8.5)
    c.saveState()
    c.rotate(90)
    c.drawCentredString(PAGE_HEIGHT / 2, -9 * mm, note)
    c.restoreState()
    c.saveState()
    c.rotate(-90)
    c.drawCentredString(-PAGE_HEIGHT / 2, PAGE_WIDTH - 9 * mm, note)
    c.restoreState()

    c.setFont("Times-Roman", 8.4)
    c.drawString(18 * mm, 9 * mm, note)
    c.drawCentredString(PAGE_WIDTH / 2, 8.5 * mm, str(page_number))
    c.drawRightString(PAGE_WIDTH - 18 * mm, 9 * mm, "Mr. Cat Academy")
    c.restoreState()


class BbcWorksheetPdf:
    def __init__(self, data: dict, meta: dict, output_path: Path):
        self.data = data
        self.meta = meta
        self.output_path = output_path
        self.canvas = canvas.Canvas(str(output_path), pagesize=A4)
        self.page_number = 0
        self.body_style = ParagraphStyle(
            "Body",
            fontName="Times-Roman",
            fontSize=9.2,
            leading=11.2,
            textColor=RULE,
        )
        self.mc_question_style = ParagraphStyle(
            "MCQuestion",
            fontName="Times-Bold",
            fontSize=10.3,
            leading=12,
            textColor=RULE,
        )
        self.mc_option_style = ParagraphStyle(
            "MCOption",
            fontName="Times-Roman",
            fontSize=10,
            leading=12.4,
            textColor=RULE,
        )

    def new_page(self) -> float:
        if self.page_number:
            self.canvas.showPage()
        self.page_number += 1
        draw_page_frame(self.canvas, self.page_number)
        return TOP_Y

    def ensure_space(self, y: float, needed: float) -> float:
        if y - needed < BOTTOM_Y:
            return self.new_page()
        return y

    def draw_title(self, y: float) -> float:
        c = self.canvas
        x = CONTENT_X
        width = CONTENT_WIDTH
        title = normalize_text(self.data.get("title") or self.meta.get("title") or self.data.get("id") or "BBC")

        c.saveState()
        c.setFont("Times-Bold", 11)
        c.drawString(x, y, "BBC 6 Minute English Listening Practice")
        y -= 7 * mm
        c.setFont("Times-Bold", 15)
        c.drawString(x, y, title[:90])
        y -= 9 * mm
        c.setFont("Times-Roman", 9.4)
        c.drawString(x, y, "Name: ____________________")
        c.drawString(x + 62 * mm, y, "Class: ____________________")
        total_questions = len(self.data.get("blanks") or []) + len(self.data.get("multipleChoice") or [])
        c.drawRightString(x + width, y, f"Score: ______ / {total_questions}")
        c.restoreState()
        return y - 9 * mm

    def draw_table_header(self, y: float) -> float:
        c = self.canvas
        x = CONTENT_X
        number_width = NUMBER_COLUMN_WIDTH
        sentence_width = CONTENT_WIDTH - number_width
        header_height = 8.5 * mm
        c.saveState()
        c.setStrokeColor(RULE)
        c.setFillColor(RULE)
        c.setLineWidth(0.55)
        c.rect(x, y - header_height, number_width, header_height)
        c.rect(x + number_width, y - header_height, sentence_width, header_height)
        c.setFont("Times-Bold", 9.6)
        c.drawCentredString(x + number_width / 2, y - 5.8 * mm, "No.")
        c.drawCentredString(x + number_width + sentence_width / 2, y - 5.8 * mm, "Sentence")
        c.restoreState()
        return y - header_height

    def draw_fill_row(self, y: float, number: int, para: Paragraph, para_height: float) -> float:
        c = self.canvas
        x = CONTENT_X
        number_width = NUMBER_COLUMN_WIDTH
        sentence_width = CONTENT_WIDTH - number_width
        row_height = max(12 * mm, para_height + 5 * mm)

        c.saveState()
        c.setStrokeColor(RULE)
        c.setFillColor(RULE)
        c.setLineWidth(0.55)
        c.rect(x, y - row_height, number_width, row_height)
        c.rect(x + number_width, y - row_height, sentence_width, row_height)
        c.setFont("Times-Roman", 9.2)
        c.drawCentredString(x + number_width / 2, y - row_height / 2 - 3, str(number))
        para.drawOn(c, x + number_width + 4 * mm, y - row_height + (row_height - para_height) / 2)
        c.restoreState()
        return y - row_height

    def draw_fill_section(self, y: float) -> float:
        blanks = self.data.get("blanks") or []
        if not blanks:
            return y
        y = self.draw_table_header(y)
        sentence_width = CONTENT_WIDTH - NUMBER_COLUMN_WIDTH
        for fallback_number, item in enumerate(blanks, start=1):
            number = int(item.get("number") or fallback_number)
            text = remove_fill_number(normalize_text(item.get("sentence") or ""), number)
            text = lengthen_fill_blanks(text)
            p = paragraph(html.escape(text), self.body_style)
            height = p.wrap(sentence_width - 8 * mm, 300)[1]
            row_height = max(12 * mm, height + 5 * mm)
            if y - row_height < BOTTOM_Y:
                y = self.new_page()
                y = self.draw_table_header(y)
            y = self.draw_fill_row(y, number, p, height)
        return y - 8 * mm

    def mc_item_height(self, item: dict, question_width: float, option_width: float) -> float:
        question = paragraph(html.escape(normalize_text(item.get("question") or "")), self.mc_question_style)
        question_height = question.wrap(question_width, 100)[1]
        option_height = 0
        option_text_width = option_width - 13 * mm
        for index, option in enumerate(item.get("options") or []):
            letter = chr(ord("A") + index)
            option_text = strip_option_prefix(normalize_text(option), letter)
            p = paragraph(html.escape(option_text), self.mc_option_style)
            measured_height = p.wrap(option_text_width, 100)[1]
            option_height += max(5.6 * mm, measured_height)
            option_height += 1.25 * mm if measured_height > 6.2 * mm else 0.55 * mm
        return max(25 * mm, question_height + option_height + 9 * mm)

    def draw_mc_item(self, y: float, item: dict, question_width: float, option_width: float, row_height: float) -> float:
        c = self.canvas
        x = CONTENT_X
        number_width = 9 * mm
        text_x = x + 13 * mm
        top_padding = 4.2 * mm

        c.saveState()
        c.setFillColor(RULE)
        c.setFont("Times-Roman", 10.2)
        c.drawRightString(x + number_width, y - top_padding - 3.5 * mm, str(item.get("number") or ""))

        question = paragraph(html.escape(normalize_text(item.get("question") or "")), self.mc_question_style)
        question_height = question.wrap(question_width, 100)[1]
        question.drawOn(c, text_x, y - top_padding - question_height)

        option_y = y - top_padding - question_height - 2.1 * mm
        option_text_width = option_width - 13 * mm
        for index, option in enumerate(item.get("options") or []):
            letter = chr(ord("A") + index)
            option_text = strip_option_prefix(normalize_text(option), letter)
            p = paragraph(html.escape(option_text), self.mc_option_style)
            measured_height = p.wrap(option_text_width, 100)[1]
            option_height = max(5.6 * mm, measured_height)
            option_gap = 1.25 * mm if measured_height > 6.2 * mm else 0.55 * mm
            letter_y = option_y - 3.7 * mm
            c.setFont("Times-Roman", 10)
            c.drawString(text_x, letter_y, letter)
            p.drawOn(c, text_x + 10 * mm, option_y - option_height)
            option_y -= option_height + option_gap

        c.restoreState()
        return y - row_height

    def draw_mc_section(self, y: float) -> float:
        mc_items = self.data.get("multipleChoice") or []
        if not mc_items:
            return y
        question_width = CONTENT_WIDTH - 15 * mm
        option_width = CONTENT_WIDTH - 15 * mm
        for item in mc_items:
            row_height = self.mc_item_height(item, question_width, option_width)
            if y - row_height < BOTTOM_Y:
                y = self.new_page()
            y = self.draw_mc_item(y, item, question_width, option_width, row_height)
        return y

    def draw(self) -> None:
        y = self.new_page()
        y = self.draw_title(y)
        y = self.draw_fill_section(y)
        self.draw_mc_section(y)
        self.canvas.save()


def content_meta_for(set_id: str) -> dict:
    path = PROJECT_ROOT / "content" / "bbc-six-minute-english" / f"{set_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def data_for(set_id: str) -> dict:
    path = PROJECT_ROOT / "data" / f"{set_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing BBC data file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def output_path_for(set_id: str) -> Path:
    return PROJECT_ROOT / "assets" / "pdf" / "bbc-six-minute-english" / set_id / f"{set_id}-worksheet.pdf"


def discover_set_ids() -> list[str]:
    return sorted(path.stem for path in (PROJECT_ROOT / "data").glob("BBC-*.json"))


def render_set(set_id: str) -> Path:
    data = data_for(set_id)
    meta = content_meta_for(set_id)
    output_path = output_path_for(set_id)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    BbcWorksheetPdf(data, meta, output_path).draw()
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate no-answer BBC worksheet PDFs.")
    parser.add_argument("set_ids", nargs="*", help="Optional BBC set IDs. Defaults to all BBC data files.")
    args = parser.parse_args()

    set_ids = args.set_ids or discover_set_ids()
    generated = [render_set(set_id) for set_id in set_ids]
    print(f"Generated {len(generated)} BBC worksheet PDFs.")
    for path in generated:
        print(path.relative_to(PROJECT_ROOT))


if __name__ == "__main__":
    main()
