#!/usr/bin/env python3
"""Generate student vocabulary worksheet PDFs from public vocabulary JSON."""

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
MUTED = colors.HexColor("#333333")


def register_fonts() -> None:
    # Standard PDF fonts keep generated worksheets portable across viewers.
    return None


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
    return re.sub(r"_{5,}", "________", text)


def paragraph_markup(markup: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(markup, style)


def draw_wrapped(c: canvas.Canvas, paragraph: Paragraph, x: float, y: float, width: float) -> float:
    height = paragraph.wrap(width, 500)[1]
    paragraph.drawOn(c, x, y - height)
    return y - height


def draw_page_frame(c: canvas.Canvas, page_number: int, footer_right: str) -> None:
    c.saveState()
    c.setStrokeColor(RULE)
    c.setFillColor(RULE)
    c.setLineWidth(0.75)
    c.rect(FRAME_X, FRAME_Y, FRAME_WIDTH, FRAME_HEIGHT)

    margin_note = "Answers written in the margins will not be marked."
    c.setFont("Times-Roman", 8.5)

    c.saveState()
    c.rotate(90)
    c.drawCentredString(PAGE_HEIGHT / 2, -9 * mm, margin_note)
    c.restoreState()

    c.saveState()
    c.rotate(-90)
    c.drawCentredString(-PAGE_HEIGHT / 2, PAGE_WIDTH - 9 * mm, margin_note)
    c.restoreState()

    c.setFont("Times-Roman", 8.4)
    c.drawString(18 * mm, 9 * mm, margin_note)
    c.drawCentredString(PAGE_WIDTH / 2, 8.5 * mm, str(page_number))
    c.drawRightString(PAGE_WIDTH - 18 * mm, 9 * mm, footer_right)
    c.restoreState()


class WorksheetPdf:
    def __init__(self, output_path: Path, unit: dict):
        self.output_path = output_path
        self.unit = unit
        self.canvas = canvas.Canvas(str(output_path), pagesize=A4)
        self.page_number = 0
        self.instruction_style = ParagraphStyle(
            "Instruction",
            fontName="Times-Roman",
            fontSize=10.3,
            leading=13.2,
            textColor=RULE,
        )
        self.bank_style = ParagraphStyle(
            "WordBank",
            fontName="Times-Roman",
            fontSize=9.5,
            leading=12,
            textColor=RULE,
        )
        self.question_style = ParagraphStyle(
            "Question",
            fontName="Times-Roman",
            fontSize=9.4,
            leading=11.4,
            textColor=RULE,
        )

    def new_page(self) -> None:
        if self.page_number:
            self.canvas.showPage()
        self.page_number += 1
        draw_page_frame(self.canvas, self.page_number, "Mr. Cat Academy")

    def draw_word_bank(self, group: dict, x: float, y: float, width: float) -> float:
        words = " | ".join(group.get("wordList") or [])
        bank = paragraph_markup(f"<b>Words:</b> {html.escape(words)}", self.bank_style)
        height = bank.wrap(width - 10 * mm, 100)[1] + 8 * mm

        c = self.canvas
        c.saveState()
        c.setStrokeColor(MUTED)
        c.setFillColor(colors.white)
        c.setLineWidth(0.55)
        c.rect(x, y - height, width, height, fill=0, stroke=1)
        c.restoreState()
        bank.drawOn(c, x + 5 * mm, y - height + 4 * mm)
        return y - height

    def question_rows(self, questions: list[dict], sentence_width: float) -> list[dict]:
        rows = []
        for fallback_number, question in enumerate(questions, start=1):
            number = question.get("number") or fallback_number
            prompt = normalize_prompt(question.get("prompt") or "")
            markup = f"{html.escape(str(number))}.&nbsp;&nbsp;{html.escape(prompt)}"
            para = paragraph_markup(markup, self.question_style)
            para_height = para.wrap(sentence_width - 12 * mm, 500)[1]
            row_height = max(14.6 * mm, para_height + 7 * mm)
            rows.append({"paragraph": para, "paragraph_height": para_height, "row_height": row_height})
        return rows

    def shrink_rows_to_fit(self, rows: list[dict], available_height: float) -> None:
        total_height = sum(row["row_height"] for row in rows)
        if total_height <= available_height:
            return

        overflow = total_height - available_height
        adjustable = [row for row in rows if row["row_height"] > 12.8 * mm]
        while overflow > 0 and adjustable:
            share = overflow / len(adjustable)
            next_adjustable = []
            reduced = 0
            for row in adjustable:
                room = row["row_height"] - 12.8 * mm
                change = min(room, share)
                row["row_height"] -= change
                reduced += change
                if row["row_height"] > 12.8 * mm:
                    next_adjustable.append(row)
            if reduced <= 0.1:
                break
            overflow -= reduced
            adjustable = next_adjustable

    def draw_question_table(self, group: dict, x: float, y: float, width: float) -> float:
        c = self.canvas
        answer_width = 34 * mm
        sentence_width = width - answer_width
        header_height = 9 * mm
        rows = self.question_rows(group.get("questions") or [], sentence_width)
        self.shrink_rows_to_fit(rows, y - BOTTOM_Y - header_height)

        c.saveState()
        c.setStrokeColor(RULE)
        c.setFillColor(RULE)
        c.setLineWidth(0.55)

        c.rect(x, y - header_height, sentence_width, header_height)
        c.rect(x + sentence_width, y - header_height, answer_width, header_height)
        c.setFont("Times-Bold", 10)
        c.drawCentredString(x + sentence_width / 2, y - 6 * mm, "Sentence")
        c.drawCentredString(x + sentence_width + answer_width / 2, y - 6 * mm, "Answer")
        y -= header_height

        for row in rows:
            row_height = row["row_height"]
            para = row["paragraph"]
            para_height = row["paragraph_height"]
            c.rect(x, y - row_height, sentence_width, row_height)
            c.rect(x + sentence_width, y - row_height, answer_width, row_height)

            # Center the sentence paragraph vertically inside the table cell.
            paragraph_y = y - row_height + (row_height - para_height) / 2
            para.drawOn(c, x + 6 * mm, paragraph_y)
            y -= row_height

        c.restoreState()
        return y

    def draw_group(self, group: dict) -> None:
        self.new_page()
        c = self.canvas
        x = CONTENT_X
        y = TOP_Y
        width = CONTENT_WIDTH
        title = group_title(self.unit, group)

        c.saveState()
        c.setFont("Times-Roman", 10.3)
        c.setFillColor(RULE)
        c.drawString(x, y, str(group_index(self.unit, group)))
        c.setFont("Times-Italic", 9.3)
        c.drawRightString(x + width, y, "(10 marks)")
        c.restoreState()

        instruction = (
            f"{title}. Fill in each blank with ONE word from the box and "
            "write your answers in the Answer column."
        )
        y = draw_wrapped(c, paragraph_markup(html.escape(instruction), self.instruction_style), x + 8 * mm, y + 2, width - 23 * mm)
        y -= 7 * mm

        y = self.draw_word_bank(group, x, y, width)
        y -= 8 * mm
        self.draw_question_table(group, x, y, width)

    def save(self) -> None:
        self.canvas.save()


def output_dir_for(set_id: str) -> Path:
    return PROJECT_ROOT / "assets" / "pdf" / "vocabulary" / set_id


def render_pdf(unit: dict, groups: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = WorksheetPdf(output_path, unit)
    for group in groups:
        doc.draw_group(group)
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
    render_pdf(unit, groups, all_pdf)

    for group in groups:
        render_pdf(unit, [group], out_dir / group_pdf_name(unit, group))

    print(f"Generated {1 + len(groups)} PDFs in {out_dir}")


if __name__ == "__main__":
    main()
