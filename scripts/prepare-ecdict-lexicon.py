#!/usr/bin/env python3
"""Merge a bounded, frequency-ranked ECDICT subset into the curated lexicon."""

import argparse
import csv
import hashlib
import heapq
import io
import json
import pathlib
import unicodedata
import urllib.request


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).strip().lower().split())


def compact(value):
    return " ".join(str(value or "").replace("\\n", "; ").split())


def lexicon_id(word):
    digest = hashlib.sha256(word.encode("utf-8")).hexdigest()[:32]
    return f"lex_{digest}"


def positive_rank(value):
    try:
        number = int(value or 0)
        return number if number > 0 else 10**9
    except (TypeError, ValueError):
        return 10**9


def open_source(source):
    if source.startswith("https://"):
        response = urllib.request.urlopen(source, timeout=90)
        return io.TextIOWrapper(response, encoding="utf-8-sig", newline="")
    return open(source, "r", encoding="utf-8-sig", newline="")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="ECDICT CSV path or HTTPS URL")
    parser.add_argument("--curated", required=True, help="Curated JSON Lines input")
    parser.add_argument("--output", required=True, help="Merged JSON Lines output")
    parser.add_argument("--limit", type=int, default=30000, help="Maximum ECDICT-only entries")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be at least 1")

    curated = []
    seen = set()
    with open(args.curated, "r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            curated.append(record)
            seen.add(normalized(record.get("normalized_word")))

    candidates = []
    sequence = 0
    with open_source(args.source) as handle:
        for row in csv.DictReader(handle):
            word = compact(row.get("word"))
            key = normalized(word)
            if not key or key in seen:
                continue
            rank = min(positive_rank(row.get("frq")), positive_rank(row.get("bnc")))
            sequence += 1
            record = {
                "lexicon_id": lexicon_id(key),
                "normalized_word": key,
                "word": word,
                "phonetic": compact(row.get("phonetic")),
                "part_of_speech": compact(row.get("pos")),
                "english_definition": compact(row.get("definition")),
                "chinese_meaning": compact(row.get("translation")),
                "word_forms": compact(row.get("exchange")),
                "emoji": "",
                "sources": ["ECDICT"],
                "source_type": "ecdict",
                "verified": False,
                "lexicon_version": "ECDICT-2026-07",
                "frequency_rank": None if rank >= 10**9 else rank,
            }
            item = (-rank, -sequence, record)
            if len(candidates) < args.limit:
                heapq.heappush(candidates, item)
            elif item > candidates[0]:
                heapq.heapreplace(candidates, item)

    selected = [item[2] for item in candidates]
    selected.sort(key=lambda item: (item.get("frequency_rank") or 10**9, item["normalized_word"]))
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for record in curated + selected:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Merged {len(curated)} curated + {len(selected)} ECDICT entries")


if __name__ == "__main__":
    main()
