#!/usr/bin/env python3
"""Pull digests, run server collection, and publish through the news API."""

import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

CATEGORIES = ("world", "crypto", "invest")
DEFAULT_SERVER_URL = "http://127.0.0.1:5174"
LOCAL_DIR = Path(os.environ.get("NEWS_LOCAL_DIR", "/tmp"))
RAW_DIR = LOCAL_DIR / "news-raw"
LOCAL_FILES = {
    category: (LOCAL_DIR / f"{category}-news.md", LOCAL_DIR / f"{category}.md")
    for category in CATEGORIES
}


def server_url(value):
    raw = value or os.environ.get("NEWS_SERVER_URL") or DEFAULT_SERVER_URL
    return raw.rstrip("/")


def endpoint(base_url, category):
    return f"{base_url}/api/digests/{category}"


def collection_endpoint(base_url, category):
    return f"{base_url}/api/collections/{category}"


def atomic_write(target, body):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="wb", dir=target.parent, prefix=f".{target.name}.", delete=False
    ) as temporary:
        temporary.write(body)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, target)


def pull(base_url, category):
    request = urllib.request.Request(
        endpoint(base_url, category),
        headers={"Accept": "text/markdown"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            for target in LOCAL_FILES[category]:
                target.unlink(missing_ok=True)
            print(f"category={category} action=pull status=missing")
            return
        raise

    if not body.strip():
        raise RuntimeError(f"server returned an empty {category} digest")
    for target in LOCAL_FILES[category]:
        atomic_write(target, body)
    print(f"category={category} action=pull status=ok bytes={len(body)}")


def push(base_url, category):
    source = LOCAL_FILES[category][0]
    try:
        body = source.read_bytes()
    except FileNotFoundError as error:
        raise RuntimeError(f"local digest does not exist: {source}") from error
    if not body.strip():
        raise RuntimeError(f"local digest is empty: {source}")

    request = urllib.request.Request(
        endpoint(base_url, category),
        data=body,
        headers={
            "Content-Type": "text/markdown; charset=utf-8",
        },
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read() or b"{}")
    print(
        f"category={category} action=push status=ok "
        f"bytes={payload.get('bytes', len(body))}"
    )


def collect(base_url, category, date_from, date_to):
    request = urllib.request.Request(
        collection_endpoint(base_url, category),
        data=json.dumps({"dateFrom": date_from, "dateTo": date_to}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        job = json.loads(response.read())

    job_id = job.get("id")
    if not job_id:
        raise RuntimeError("server did not return a collection job id")

    timeout_seconds = int(os.environ.get("NEWS_COLLECTION_TIMEOUT", "1800"))
    deadline = time.monotonic() + timeout_seconds
    while True:
        status_request = urllib.request.Request(
            f"{base_url}/api/collection-jobs/{job_id}",
            headers={"Accept": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(status_request, timeout=30) as response:
            job = json.loads(response.read())

        if job.get("status") == "completed":
            break
        if job.get("status") == "failed":
            raise RuntimeError(job.get("error") or "server collection failed")
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"server collection timed out after {timeout_seconds} seconds"
            )
        time.sleep(2)

    result_request = urllib.request.Request(
        f"{base_url}/api/collection-jobs/{job_id}/result",
        headers={"Accept": "text/markdown"},
        method="GET",
    )
    with urllib.request.urlopen(result_request, timeout=30) as response:
        body = response.read()
    if not body.strip():
        raise RuntimeError(f"server returned empty raw data for {category}")

    target = RAW_DIR / f"{category}.md"
    atomic_write(target, body)
    if job.get("summary"):
        print(job["summary"])
    print(
        f"category={category} action=collect status=ok "
        f"messages={job.get('messages', 'unknown')} bytes={len(body)}"
    )


def run_action(action, base_url, categories, date_from=None, date_to=None):
    for category in categories:
        if action == "pull":
            pull(base_url, category)
        elif action == "push":
            push(base_url, category)
        else:
            collect(base_url, category, date_from, date_to)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pull", "collect", "push"))
    parser.add_argument("category", choices=(*CATEGORIES, "all"))
    parser.add_argument("--date-from", help="collection start date (YYYY-MM-DD)")
    parser.add_argument("--date-to", help="collection end date (YYYY-MM-DD)")
    parser.add_argument(
        "--server",
        help=(
            "server base URL "
            f"(defaults to NEWS_SERVER_URL or {DEFAULT_SERVER_URL})"
        ),
    )
    args = parser.parse_args()

    try:
        if args.action == "collect" and (not args.date_from or not args.date_to):
            raise RuntimeError("collect requires --date-from and --date-to")
        base_url = server_url(args.server)
        categories = CATEGORIES if args.category == "all" else (args.category,)
        run_action(args.action, base_url, categories, args.date_from, args.date_to)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(
            f"server request failed: HTTP {error.code}: {detail}",
            file=sys.stderr,
        )
        return 1
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        print(f"server request failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
