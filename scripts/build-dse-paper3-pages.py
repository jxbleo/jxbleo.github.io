#!/usr/bin/env python3
"""Convert the DSE Paper 3 DOCX into five public preview pages.

The source document remains outside the repository. This small, dependency-free
converter keeps the generated pages easy to refresh when the handout changes.
"""

from __future__ import annotations

import argparse
import html
import posixpath
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W_NS, "r": R_NS}


PARTS = [
    {
        "number": 1,
        "slug": "dse-paper-3-listening-foundation",
        "title": "考试底图与听力核心模型",
        "eyebrow": "Foundation",
        "summary": "先看清 Paper 3 的结构，再用问题驱动的方式进入听力。",
    },
    {
        "number": 2,
        "slug": "dse-paper-3-listening-notes",
        "title": "听中策略与快速笔记系统",
        "eyebrow": "Listening & Notes",
        "summary": "把听到的信息压缩成可追踪、可核实、可得分的记录。",
    },
    {
        "number": 3,
        "slug": "dse-paper-3-question-strategies",
        "title": "陷阱、Part A 与 Part B 题型策略",
        "eyebrow": "Question Strategies",
        "summary": "从高频陷阱到 Part B 的听、读、写整合，建立稳定的做题路径。",
    },
    {
        "number": 4,
        "slug": "dse-paper-3-level-roadmaps",
        "title": "Level 3 稳分与 Level 5** 冲刺",
        "eyebrow": "Score Roadmaps",
        "summary": "按目标等级安排优先级，把失分诊断变成四周训练计划。",
    },
    {
        "number": 5,
        "slug": "dse-paper-3-practice-toolkit",
        "title": "练习、答案与考场工具包",
        "eyebrow": "Practice Toolkit",
        "summary": "用原创练习、答案解析、清单和模板完成最后一轮复盘。",
    },
]


CN_CHAPTERS = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
    "十一": 11,
    "十二": 12,
    "十三": 13,
    "十四": 14,
}


def qname(namespace: str, local: str) -> str:
    return f"{{{namespace}}}{local}"


def load_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    return ET.fromstring(zf.read(name))


def style_names(styles_root: ET.Element) -> dict[str, str]:
    names: dict[str, str] = {}
    for style in styles_root.findall("w:style", NS):
        style_id = style.get(qname(W_NS, "styleId"))
        name = style.find("w:name", NS)
        if style_id and name is not None:
            names[style_id] = name.get(qname(W_NS, "val"), style_id)
    return names


def relationships(zf: zipfile.ZipFile) -> dict[str, str]:
    root = load_xml(zf, "word/_rels/document.xml.rels")
    result: dict[str, str] = {}
    for rel in root.findall(f"{{{PKG_REL_NS}}}Relationship"):
        if rel.get("TargetMode") == "External":
            result[rel.get("Id", "")] = rel.get("Target", "")
    return result


def text_content(node: ET.Element) -> str:
    pieces: list[str] = []
    for child in node.iter():
        if child.tag == qname(W_NS, "t"):
            pieces.append(child.text or "")
        elif child.tag in {qname(W_NS, "tab"), qname(W_NS, "br")}:
            pieces.append(" ")
    return re.sub(r"[ \t]+", " ", "".join(pieces)).strip()


def run_markup(run: ET.Element) -> str:
    text = "".join((el.text or "") for el in run.iter(qname(W_NS, "t")))
    if not text:
        if run.find(f".//w:tab", NS) is not None:
            text = " "
        elif run.find(f".//w:br", NS) is not None:
            text = "<br>"
        else:
            return ""
    text = html.escape(text)
    props = run.find("w:rPr", NS)
    if props is not None:
        if props.find("w:b", NS) is not None:
            text = f"<strong>{text}</strong>"
        if props.find("w:i", NS) is not None:
            text = f"<em>{text}</em>"
    return text


def inline_markup(node: ET.Element, rels: dict[str, str]) -> str:
    chunks: list[str] = []
    for child in list(node):
        if child.tag == qname(W_NS, "r"):
            chunks.append(run_markup(child))
        elif child.tag == qname(W_NS, "hyperlink"):
            link_id = child.get(qname(R_NS, "id"), "")
            body = "".join(run_markup(run) for run in child.findall(".//w:r", NS))
            href = rels.get(link_id, "")
            if href:
                chunks.append(f'<a href="{html.escape(href, quote=True)}" target="_blank" rel="noopener">{body}</a>')
            else:
                chunks.append(body)
        elif child.tag == qname(W_NS, "proofErr"):
            continue
    return "".join(chunks).strip()


def paragraph_style(paragraph: ET.Element, styles: dict[str, str]) -> str:
    style = paragraph.find("w:pPr/w:pStyle", NS)
    style_id = style.get(qname(W_NS, "val"), "") if style is not None else ""
    return styles.get(style_id, style_id)


def table_rows(table: ET.Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in table.findall("w:tr", NS):
        cells: list[str] = []
        for tc in tr.findall("w:tc", NS):
            cells.append(text_content(tc))
        if cells:
            rows.append(cells)
    return rows


def is_heading_one(style: str) -> bool:
    return style.lower().replace(" ", "") in {"heading1", "标题1"}


def is_heading_two(style: str) -> bool:
    return style.lower().replace(" ", "") in {"heading2", "标题2"}


def is_list(style: str) -> bool:
    lowered = style.lower()
    return "list" in lowered or "bullet" in lowered or "number" in lowered or "列表" in style


def heading_part(text: str) -> int | None:
    if text.startswith("附录") or text.startswith("参考答案") or text.startswith("官方依据"):
        return 5
    match = re.search(r"第([一二三四五六七八九十百]+)章", text)
    if match:
        chapter = CN_CHAPTERS.get(match.group(1))
        if chapter is None:
            return 1
        if chapter <= 2:
            return 1
        if chapter <= 5:
            return 2
        if chapter <= 8:
            return 3
        if chapter <= 12:
            return 4
        return 5
    if text in {"使用方法与路线图", "考试底图：你正在考什么？"}:
        return 1
    return None


def render_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    if len(rows) == 1 and len(rows[0]) == 1:
        return f'<aside class="paper-callout">{html.escape(rows[0][0]).replace(chr(10), "<br>")}</aside>'
    head = rows[0]
    body = rows[1:]
    head_html = "".join(f"<th>{html.escape(cell).replace(chr(10), '<br>')}</th>" for cell in head)
    body_html = "".join(
        "<tr>" + "".join(f"<td>{html.escape(cell).replace(chr(10), '<br>')}</td>" for cell in row) + "</tr>"
        for row in body
    )
    return f'<div class="paper-table-wrap"><table class="paper-table"><thead><tr>{head_html}</tr></thead><tbody>{body_html}</tbody></table></div>'


def parse_nodes(docx_path: Path) -> list[dict]:
    with zipfile.ZipFile(docx_path) as zf:
        document = load_xml(zf, "word/document.xml")
        styles = style_names(load_xml(zf, "word/styles.xml"))
        rels = relationships(zf)
        body = document.find("w:body", NS)
        assert body is not None
        nodes: list[dict] = []
        for child in list(body):
            if child.tag == qname(W_NS, "p"):
                text = text_content(child)
                if not text:
                    continue
                style = paragraph_style(child, styles)
                nodes.append({"kind": "p", "text": text, "markup": inline_markup(child, rels), "style": style})
            elif child.tag == qname(W_NS, "tbl"):
                rows = table_rows(child)
                if rows:
                    nodes.append({"kind": "tbl", "rows": rows})
        return nodes


def render_nodes(nodes: list[dict]) -> str:
    chunks: list[str] = []
    list_open = False
    for node in nodes:
        if node["kind"] == "tbl":
            if list_open:
                chunks.append("</ul>")
                list_open = False
            chunks.append(render_table(node["rows"]))
            continue
        style = node["style"]
        if is_heading_one(style):
            if list_open:
                chunks.append("</ul>")
                list_open = False
            chunks.append(f'<h2 class="paper-section">{node["markup"]}</h2>')
        elif is_heading_two(style):
            if list_open:
                chunks.append("</ul>")
                list_open = False
            chunks.append(f'<h3 class="paper-subsection">{node["markup"]}</h3>')
        elif is_list(style):
            if not list_open:
                chunks.append('<ul class="paper-list">')
                list_open = True
            chunks.append(f'<li>{node["markup"]}</li>')
        else:
            if list_open:
                chunks.append("</ul>")
                list_open = False
            chunks.append(f'<p class="paper-paragraph">{node["markup"]}</p>')
    if list_open:
        chunks.append("</ul>")
    return "\n".join(chunks)


def page_html(part: dict, body: str) -> str:
    number = part["number"]
    contact_heading = "想继续获取更多部分？" if number == 5 else f"想继续获取 Part {number + 1}–5？"
    progress = "".join(
        f'<span class="part-dot {"is-current" if p["number"] == number else ""}" aria-label="Part {p["number"]} of 5"></span>'
        for p in PARTS
    )
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="DSE English Paper 3 讲义 Part {number} of 5：{html.escape(part["title"])}。公开预览版。">
  <meta property="og:title" content="DSE English Paper 3 · Part {number} of 5 · {html.escape(part["title"])}">
  <meta property="og:description" content="{html.escape(part["summary"])} 公开预览版，完整学习路径请联系猫先生英语。">
  <meta property="og:type" content="article">
  <title>DSE English Paper 3 · Part {number} of 5 · {html.escape(part["title"])}</title>
  <link rel="stylesheet" href="assets/css/dse-paper3.css?v=20260821-1">
</head>
<body>
  <header class="paper-topbar">
    <a class="paper-brand" href="index.html">Mr. Cat English</a>
    <a class="paper-home" href="index.html">回到主页</a>
  </header>
  <main class="paper-shell">
    <section class="paper-hero">
      <div class="paper-hero-copy">
        <p class="paper-kicker">DSE ENGLISH PAPER 3 · LISTENING &amp; INTEGRATED SKILLS</p>
        <div class="part-label"><span>PART {number}</span><strong>OF 5</strong></div>
        <h1>{html.escape(part["title"])}</h1>
        <p class="paper-summary">{html.escape(part["summary"])}</p>
      </div>
      <div class="part-progress" aria-label="本讲义共有五个部分">
        <div class="part-progress-title">这是完整讲义的第 {number} 部分，共 5 个部分</div>
        <div class="part-dots">{progress}</div>
        <p>本页是公开预览，只展示其中一部分。</p>
      </div>
    </section>
    <section class="paper-contact-banner">
      <div>
        <strong>{contact_heading}</strong>
        <span>请在抖音或小红书搜索「猫先生英语」这个账号并联系。</span>
      </div>
      <a href="index.html">了解 Mr. Cat English</a>
    </section>
    <article class="paper-content">
      {body}
    </article>
    <section class="paper-end-card">
      <p class="paper-kicker">END OF PART {number} / 5</p>
      <h2>这只是完整讲义的其中一部分</h2>
      <p>如果你想继续看下一部分，或想了解完整的 DSE English 训练安排，请在抖音或小红书搜索「猫先生英语」这个账号。</p>
      <a class="paper-primary-action" href="index.html">返回 Mr. Cat English 主页</a>
    </section>
  </main>
  <footer class="paper-footer">DSE English Paper 3 · 公开预览 · Part {number} of 5</footer>
</body>
</html>'''


def split_parts(nodes: list[dict]) -> dict[int, list[dict]]:
    buckets = {part["number"]: [] for part in PARTS}
    current: int | None = None
    for node in nodes:
        if node["kind"] == "p" and is_heading_one(node["style"]):
            current = heading_part(node["text"]) or current
        if current is not None:
            buckets[current].append(node)
    return buckets


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("."))
    args = parser.parse_args()
    nodes = parse_nodes(args.source)
    buckets = split_parts(nodes)
    for part in PARTS:
        output = args.output / f'{part["slug"]}.html'
        output.write_text(page_html(part, render_nodes(buckets[part["number"]])), encoding="utf-8")
        print(output)


if __name__ == "__main__":
    main()
