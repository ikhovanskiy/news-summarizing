#!/usr/bin/env python3
"""Resolve the date range for a /news category from the last generated digest."""

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

CATEGORIES = ("world", "crypto", "invest")
OUT_FILES = {
    "world": (Path("/tmp/world.md"), Path("/tmp/world-news.md")),
    "crypto": (Path("/tmp/crypto.md"), Path("/tmp/crypto-news.md")),
    "invest": (Path("/tmp/invest.md"), Path("/tmp/invest-news.md")),
}
DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")


def yesterday():
    return dt.datetime.now().astimezone().date() - dt.timedelta(days=1)


def parse_header_dates(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return None

    for line in lines[:20]:
        if not line.startswith("#"):
            continue
        dates = DATE_RE.findall(line)
        if dates:
            return dt.date.fromisoformat(dates[-1])
    return None


def last_generated_date(category):
    for path in OUT_FILES[category]:
        found = parse_header_dates(path)
        if found:
            return found, path
    return None, None


def main():
    parser = argparse.ArgumentParser(description="Resolve /news catch-up date range")
    parser.add_argument("category", choices=CATEGORIES)
    parser.add_argument(
        "--after-last",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    date_to = yesterday()
    last_date, source = last_generated_date(args.category)

    if last_date is None:
        date_from = date_to
        source_label = "none"
    else:
        # A generated digest already contains last_date. Catch-up must start on
        # the following calendar day so users never receive the same day twice.
        date_from = last_date + dt.timedelta(days=1)
        source_label = str(source)

    status = "up_to_date" if date_from > date_to else "ready"

    print(
        f"category={args.category} "
        f"status={status} "
        f"date_from={date_from.isoformat()} "
        f"date_to={date_to.isoformat()} "
        f"last_date={(last_date.isoformat() if last_date else 'none')} "
        f"source={source_label}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
