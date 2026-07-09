#!/usr/bin/env python3
"""Generate student vocabulary worksheet PDFs from public vocabulary JSON."""

from __future__ import annotations

import argparse
import html
import io
import json
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - optional local rendering helper
    Image = ImageDraw = ImageFont = None


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
STUDY_ACCENT = colors.HexColor("#0f766e")
STUDY_LIGHT = colors.HexColor("#edf7f5")
STUDY_RULE = colors.HexColor("#667085")
NUMBER_COLUMN_WIDTH = 11 * mm
ANSWER_COLUMN_WIDTH = 20.4 * mm
WORDLIST_CJK_FONT = "Times-Roman"
WORDLIST_CJK_BOLD_FONT = "Times-Bold"
EMOJI_FONT_PATH = Path("/System/Library/Fonts/Apple Color Emoji.ttc")
EMOJI_FONT_SIZES = (32, 40, 20, 48)
_emoji_font = None
_emoji_cache = {}


def register_fonts() -> None:
    global WORDLIST_CJK_FONT, WORDLIST_CJK_BOLD_FONT, _emoji_font
    for path in (
        Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    ):
        if not path.exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont("WordlistCJK", str(path), subfontIndex=0))
            WORDLIST_CJK_FONT = "WordlistCJK"
            WORDLIST_CJK_BOLD_FONT = "WordlistCJK"
            break
        except Exception:
            continue

    if ImageFont is not None and EMOJI_FONT_PATH.exists():
        for size in EMOJI_FONT_SIZES:
            try:
                _emoji_font = ImageFont.truetype(str(EMOJI_FONT_PATH), size)
                break
            except OSError:
                continue


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


def clean_inline_text(value: str, break_replacement: str = "; ") -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<\s*br\s*/?\s*>", break_replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


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


def draw_study_page_frame(c: canvas.Canvas, page_number: int, footer_right: str) -> None:
    c.saveState()
    c.setStrokeColor(STUDY_RULE)
    c.setFillColor(RULE)
    c.setLineWidth(0.65)
    c.rect(FRAME_X, FRAME_Y, FRAME_WIDTH, FRAME_HEIGHT)

    c.setFont("Times-Roman", 8.4)
    c.drawString(18 * mm, 9 * mm, "Fold or cover the Meaning column for self-check.")
    c.drawCentredString(PAGE_WIDTH / 2, 8.5 * mm, str(page_number))
    c.drawRightString(PAGE_WIDTH - 18 * mm, 9 * mm, footer_right)
    c.restoreState()


def emoji_reader(emoji_text: str) -> ImageReader | None:
    if not emoji_text or Image is None or ImageDraw is None or _emoji_font is None:
        return None
    if emoji_text in _emoji_cache:
        return _emoji_cache[emoji_text]
    bbox = _emoji_font.getbbox(emoji_text)
    width = max(1, bbox[2] - bbox[0] + 8)
    height = max(1, bbox[3] - bbox[1] + 8)
    image = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.text((4 - bbox[0], 4 - bbox[1]), emoji_text, font=_emoji_font, embedded_color=True)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    reader = ImageReader(buffer)
    _emoji_cache[emoji_text] = reader
    return reader

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
            para = paragraph_markup(html.escape(prompt), self.question_style)
            para_height = para.wrap(sentence_width - 8 * mm, 500)[1]
            row_height = max(14.6 * mm, para_height + 7 * mm)
            rows.append({
                "number": str(number),
                "paragraph": para,
                "paragraph_height": para_height,
                "row_height": row_height,
            })
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
        number_width = NUMBER_COLUMN_WIDTH
        answer_width = ANSWER_COLUMN_WIDTH
        sentence_width = width - number_width - answer_width
        header_height = 9 * mm
        rows = self.question_rows(group.get("questions") or [], sentence_width)
        self.shrink_rows_to_fit(rows, y - BOTTOM_Y - header_height)

        c.saveState()
        c.setStrokeColor(RULE)
        c.setFillColor(RULE)
        c.setLineWidth(0.55)

        c.rect(x, y - header_height, number_width, header_height)
        c.rect(x + number_width, y - header_height, sentence_width, header_height)
        c.rect(x + number_width + sentence_width, y - header_height, answer_width, header_height)
        c.setFont("Times-Bold", 10)
        c.drawCentredString(x + number_width / 2, y - 6 * mm, "No.")
        c.drawCentredString(x + number_width + sentence_width / 2, y - 6 * mm, "Sentence")
        c.drawCentredString(x + number_width + sentence_width + answer_width / 2, y - 6 * mm, "Answer")
        y -= header_height

        for row in rows:
            row_height = row["row_height"]
            para = row["paragraph"]
            para_height = row["paragraph_height"]
            c.rect(x, y - row_height, number_width, row_height)
            c.rect(x + number_width, y - row_height, sentence_width, row_height)
            c.rect(x + number_width + sentence_width, y - row_height, answer_width, row_height)

            c.setFont("Times-Roman", 9.4)
            c.drawCentredString(x + number_width / 2, y - row_height / 2 - 3, row["number"])

            # Center the sentence paragraph vertically inside the table cell.
            paragraph_y = y - row_height + (row_height - para_height) / 2
            para.drawOn(c, x + number_width + 4 * mm, paragraph_y)
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


class WordlistPdf:
    def __init__(self, output_path: Path, unit: dict):
        self.output_path = output_path
        self.unit = unit
        self.canvas = canvas.Canvas(str(output_path), pagesize=A4)
        self.page_number = 0
        self.word_style = ParagraphStyle(
            "WordlistWord",
            fontName="Times-Roman",
            fontSize=9.4,
            leading=10.4,
            textColor=RULE,
        )
        self.meaning_style = ParagraphStyle(
            "WordlistMeaning",
            fontName=WORDLIST_CJK_FONT,
            fontSize=7.5,
            leading=9.1,
            textColor=RULE,
        )

    def new_page(self) -> float:
        if self.page_number:
            self.canvas.showPage()
        self.page_number += 1
        draw_study_page_frame(self.canvas, self.page_number, "Mr. Cat Academy")
        return self.draw_header()

    def draw_header(self) -> float:
        c = self.canvas
        x = CONTENT_X
        y = TOP_Y
        width = CONTENT_WIDTH
        title = f"{self.unit.get('id', 'Vocabulary')} Vocabulary Wordlist"

        c.saveState()
        c.setFillColor(STUDY_ACCENT)
        c.setStrokeColor(STUDY_ACCENT)
        c.setLineWidth(0.8)
        c.line(x, y - 8 * mm, x + width, y - 8 * mm)

        icon = emoji_reader("📚")
        if icon:
            c.drawImage(icon, x, y - 6 * mm, width=6 * mm, height=6 * mm, mask="auto")
            title_x = x + 8 * mm
        else:
            title_x = x

        c.setFillColor(RULE)
        c.setFont("Times-Bold", 14)
        c.drawString(title_x, y - 2.5 * mm, title)
        c.setFont("Times-Roman", 8.4)
        meta = f"{self.unit.get('sourceName', 'Vocabulary')} | {self.unit.get('cefrLevel', '')} | {self.unit.get('wordCount', 0)} words"
        c.drawRightString(x + width, y - 2.5 * mm, meta)

        c.setFont("Times-Roman", 9)
        c.drawString(x, y - 14 * mm, "Name: ____________________")
        c.drawString(x + 63 * mm, y - 14 * mm, "Date: ____________________")
        c.drawRightString(x + width, y - 14 * mm, "Self Check: 1 / 2 / 3")
        c.restoreState()
        return y - 21 * mm

    def words_for_group(self, group: dict) -> list[dict]:
        start = group.get("rangeStart")
        end = group.get("rangeEnd")
        return [
            word for word in self.unit.get("words", [])
            if isinstance(word.get("number"), int) and start <= word["number"] <= end
        ]

    def word_paragraph(self, word: dict) -> Paragraph:
        label = html.escape(clean_inline_text(word.get("word") or ""))
        word_forms = clean_inline_text(word.get("wordForms") or "")
        if word_forms in {"-", "—"}:
            word_forms = ""
        meta_parts = [clean_inline_text(word.get("partOfSpeech") or ""), word_forms]
        meta = " | ".join(part for part in meta_parts if part)
        if meta:
            label += f'<br/><font name="Times-Italic" size="6.6">{html.escape(meta)}</font>'
        return Paragraph(label, self.word_style)

    def meaning_paragraph(self, word: dict) -> Paragraph:
        meaning = html.escape(clean_inline_text(word.get("meaning") or ""))
        definition = html.escape(clean_inline_text(word.get("simpleDefinition") or "", " "))
        markup = meaning
        if definition:
            markup += f'<br/><font name="Times-Italic" size="6.4">{definition}</font>'
        return Paragraph(markup, self.meaning_style)

    def group_rows(self, group: dict, word_width: float, meaning_width: float) -> list[dict]:
        rows = []
        for word in self.words_for_group(group):
            word_para = self.word_paragraph(word)
            meaning_para = self.meaning_paragraph(word)
            word_height = word_para.wrap(word_width - 4 * mm, 100)[1]
            meaning_height = meaning_para.wrap(meaning_width - 4 * mm, 100)[1]
            rows.append({
                "word": word,
                "word_para": word_para,
                "meaning_para": meaning_para,
                "word_height": word_height,
                "meaning_height": meaning_height,
                "row_height": max(10.5 * mm, word_height + 3.6 * mm, meaning_height + 3.6 * mm),
            })
        return rows

    def draw_group(self, group: dict, y: float) -> float:
        c = self.canvas
        x = CONTENT_X
        width = CONTENT_WIDTH
        number_width = 10 * mm
        emoji_width = 14 * mm
        word_width = 38 * mm
        check_width = 21 * mm
        meaning_width = width - number_width - emoji_width - word_width - check_width
        group_label_height = 8 * mm
        table_header_height = 7.5 * mm
        rows = self.group_rows(group, word_width, meaning_width)
        total_height = group_label_height + table_header_height + sum(row["row_height"] for row in rows) + 5 * mm

        if y - total_height < BOTTOM_Y:
            y = self.new_page()

        title = group_title(self.unit, group)
        c.saveState()
        c.setFillColor(STUDY_LIGHT)
        c.setStrokeColor(STUDY_RULE)
        c.setLineWidth(0.5)
        c.roundRect(x, y - group_label_height, width, group_label_height, 2 * mm, fill=1, stroke=1)
        c.setFillColor(RULE)
        c.setFont("Times-Bold", 9.6)
        c.drawString(x + 3 * mm, y - 5.2 * mm, title)
        c.setFont("Times-Roman", 7.8)
        c.drawRightString(x + width - 3 * mm, y - 5.2 * mm, "Cover Meaning | Tick Self Check")
        c.restoreState()
        y -= group_label_height

        c.saveState()
        c.setStrokeColor(RULE)
        c.setFillColor(RULE)
        c.setLineWidth(0.45)
        columns = [
            ("No.", number_width),
            ("Cue", emoji_width),
            ("Word", word_width),
            ("Meaning / Definition", meaning_width),
            ("Self Check", check_width),
        ]
        cursor_x = x
        for label, column_width in columns:
            c.rect(cursor_x, y - table_header_height, column_width, table_header_height)
            c.setFont("Times-Bold", 8.1)
            c.drawCentredString(cursor_x + column_width / 2, y - 5 * mm, label)
            cursor_x += column_width
        y -= table_header_height

        for row in rows:
            row_height = row["row_height"]
            word = row["word"]
            col_x = x
            for column_width in (number_width, emoji_width, word_width, meaning_width, check_width):
                c.rect(col_x, y - row_height, column_width, row_height)
                col_x += column_width

            c.setFont("Times-Roman", 8.4)
            c.drawCentredString(x + number_width / 2, y - row_height / 2 - 2.6, str(word.get("number") or ""))

            icon = emoji_reader(str(word.get("emoji") or ""))
            if icon:
                icon_w = 10 * mm
                icon_h = 5.2 * mm
                c.drawImage(
                    icon,
                    x + number_width + (emoji_width - icon_w) / 2,
                    y - row_height / 2 - icon_h / 2,
                    width=icon_w,
                    height=icon_h,
                    preserveAspectRatio=True,
                    anchor="c",
                    mask="auto",
                )

            word_y = y - row_height + (row_height - row["word_height"]) / 2
            row["word_para"].drawOn(c, x + number_width + emoji_width + 2 * mm, word_y)
            meaning_x = x + number_width + emoji_width + word_width
            meaning_y = y - row_height + (row_height - row["meaning_height"]) / 2
            row["meaning_para"].drawOn(c, meaning_x + 2 * mm, meaning_y)

            check_x = x + width - check_width
            box_size = 3.2 * mm
            box_gap = 2.2 * mm
            start_x = check_x + (check_width - (3 * box_size + 2 * box_gap)) / 2
            box_y = y - row_height / 2 - box_size / 2
            for index in range(3):
                c.rect(start_x + index * (box_size + box_gap), box_y, box_size, box_size)
            y -= row_height

        c.restoreState()
        return y - 6 * mm

    def draw(self) -> None:
        y = self.new_page()
        for group in self.unit.get("quizGroups") or []:
            y = self.draw_group(group, y)

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


def wordlist_pdf_name(unit: dict) -> str:
    return f"{unit['id']}-wordlist.pdf"


def render_wordlist_pdf(unit: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = WordlistPdf(output_path, unit)
    doc.draw()
    doc.save()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate vocabulary worksheet PDFs.")
    parser.add_argument("set_id", help="Vocabulary set id, for example NAWL-A")
    parser.add_argument(
        "--kind",
        choices=("practice", "wordlist", "all"),
        default="practice",
        help="Which PDFs to generate. Defaults to practice worksheets.",
    )
    args = parser.parse_args()

    register_fonts()
    unit = load_unit(args.set_id)
    groups = unit.get("quizGroups") or []
    if not groups:
        raise ValueError(f"{args.set_id} has no quizGroups")

    out_dir = output_dir_for(unit["id"])
    generated = 0
    if args.kind in ("practice", "all"):
        all_pdf = out_dir / f"{unit['id']}-all-sets.pdf"
        render_pdf(unit, groups, all_pdf)
        generated += 1

        for group in groups:
            render_pdf(unit, [group], out_dir / group_pdf_name(unit, group))
            generated += 1

    if args.kind in ("wordlist", "all"):
        render_wordlist_pdf(unit, out_dir / wordlist_pdf_name(unit))
        generated += 1

    print(f"Generated {generated} PDFs in {out_dir}")


if __name__ == "__main__":
    main()
