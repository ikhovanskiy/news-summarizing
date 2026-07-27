#!/usr/bin/env python3
"""
Единый детерминированный сборщик новостей из Telegram-каналов для команды /news.

ЗАЧЕМ: раньше каждый субагент сам решал, как собирать данные (MCP / скрап / выдумка),
и результат был невоспроизводим. Это — ЕДИНСТВЕННАЯ точка сбора. Субагенты НЕ собирают
данные сами: они читают готовые файлы /tmp/news-raw/<category>.md.

ПОЛИТИКА СБОРА (на каждый канал, по порядку):
  1. MTProto (telethon) с тем же session-string, что у Telegram MCP, с коротким таймаутом.
  2. Фолбэк: публичный веб-превью https://telegram.me/s/<channel> (только stdlib), с пагинацией
     назад через ?before=<id>, пока не уйдём за целевую дату.

Источник всегда фиксирован и одинаков от запуска к запуску → детерминизм.

CLI:
  python3 collect.py --date YYYY-MM-DD [--category world|crypto|invest|all] [--source auto|scrape]
  python3 collect.py --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--category world|crypto|invest|all] [--source auto|scrape]

Запуск с поддержкой MTProto-попытки:
  uv run --with telethon python3 collect.py --date 2026-06-01 --category all

Запуск сразу через скрапер без MTProto:
  python3 collect.py --date 2026-06-01 --category all --source scrape

Без telethon скрипт всё равно работает — сразу идёт в скрапер.
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()
NEWS_DIR = Path(__file__).resolve().parent
CHANNELS_FILE = NEWS_DIR / "channels.json"
MCP_CONFIG = HOME / "home" / ".mcp.json"
OUT_DIR = Path(os.environ.get("NEWS_RAW_DIR", "/tmp/news-raw"))

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
HTTP_TIMEOUT = 25          # сек на один запрос telegram.me/s/
HTTP_RETRIES = 3           # ретраи на сетевой таймаут (if_bonds иногда флапает)
PAGE_RETRIES = 3           # ретраи на страницу пагинации, если Telegram отдал кривой HTML
BEFORE_GAP_RETRIES = 5     # обход дыр в telegram.me/s/?before=<id>, где отдельный id даёт пустую страницу
MAX_PAGES = 12             # ограничение пагинации назад на канал
MAX_TEXT_LEN = 2000        # обрезка длинных сообщений
MTPROTO_TIMEOUT = 8        # сек, короткий таймаут попытки MTProto
WORLD_SOURCE_GROUPS = {"russian", "ukrainian", "european", "american"}


# --------------------------------------------------------------------------- #
# Загрузка конфигурации
# --------------------------------------------------------------------------- #
def load_channels():
    with open(CHANNELS_FILE, encoding="utf-8") as f:
        return json.load(f)


def normalize_channel_specs(specs):
    """Нормализует строки и объекты {name, group, note} в имена и метаданные."""
    channels = []
    metadata_map = {}
    seen = set()
    for spec in specs:
        if isinstance(spec, str):
            name = spec
            group = None
            note = None
        elif isinstance(spec, dict):
            name = spec.get("name")
            group = spec.get("group")
            note = spec.get("note")
        else:
            raise ValueError(f"некорректная запись канала: {spec!r}")

        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"у канала отсутствует непустое поле name: {spec!r}")
        if name in seen:
            raise ValueError(f"канал {name!r} указан повторно")
        if group is not None and group not in WORLD_SOURCE_GROUPS:
            raise ValueError(
                f"неизвестная группа {group!r} для {name!r}; "
                f"ожидается одна из {sorted(WORLD_SOURCE_GROUPS)}"
            )
        if note is not None and (not isinstance(note, str) or not note.strip()):
            raise ValueError(f"примечание note для {name!r} должно быть непустой строкой")

        seen.add(name)
        channels.append(name)
        if group or note:
            metadata_map[name] = {}
            if group:
                metadata_map[name]["group"] = group
            if note:
                metadata_map[name]["note"] = note
    return channels, metadata_map


def load_mtproto_creds():
    """Читает api_id/api_hash/session из ~/home/.mcp.json. None, если нет."""
    try:
        cfg = json.loads(MCP_CONFIG.read_text(encoding="utf-8"))
        env = cfg["mcpServers"]["telegram"]["env"]
        return {
            "api_id": int(env["TELEGRAM_API_ID"]),
            "api_hash": env["TELEGRAM_API_HASH"],
            "session": env["TELEGRAM_SESSION_STRING"],
        }
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# Способ 1: MTProto (telethon) — «сначала MCP»
# --------------------------------------------------------------------------- #
def collect_mtproto(channels, target_date, creds):
    """
    Пытается собрать сообщения за target_date через telethon.
    Возвращает dict {channel: [(time_str, text), ...]} или None при недоступности.
    Одна попытка подключения с коротким таймаутом; при провале — None (→ скрапер).
    """
    try:
        from telethon.sync import TelegramClient
        from telethon.sessions import StringSession
    except Exception:
        return None  # telethon не установлен → скрапер

    result = {}
    try:
        client = TelegramClient(
            StringSession(creds["session"]),
            creds["api_id"],
            creds["api_hash"],
            connection_retries=0,
            retry_delay=0,
            timeout=MTPROTO_TIMEOUT,
        )
        client.connect()
        if not client.is_connected() or not client.is_user_authorized():
            client.disconnect()
            return None
    except Exception:
        return None

    try:
        for ch in channels:
            msgs = []
            try:
                for m in client.iter_messages(ch, limit=200):
                    mdate = m.date.astimezone().date() if m.date else None
                    if mdate is None:
                        continue
                    if mdate > target_date:
                        continue
                    if mdate < target_date:
                        break  # сообщения идут от новых к старым → дальше только старее
                    text = (m.message or "").strip()
                    if not text:
                        continue
                    result[ch] = result.get(ch, [])
                    result[ch].append((m.date.astimezone().strftime("%H:%M"), text[:MAX_TEXT_LEN]))
            except Exception:
                # один канал упал — продолжаем остальные
                continue
            if ch in result:
                result[ch].sort()
    finally:
        try:
            client.disconnect()
        except Exception:
            pass

    return result if result else None


# --------------------------------------------------------------------------- #
# Способ 2: скрапер telegram.me/s/ — фолбэк
# --------------------------------------------------------------------------- #
def _http_get(url):
    last_err = None
    for attempt in range(HTTP_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                return resp.read().decode("utf-8", "ignore")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise last_err if last_err else RuntimeError("http failed")


# Граница одного сообщения-бабла в HTML telegram.me/s/.
_BUBBLE_SPLIT_RE = re.compile(r'(?=<div class="tgme_widget_message[ "])')
_POST_RE = re.compile(r'data-post="([^"]+)"')
_DT_RE = re.compile(r'datetime="([^"]+)"')
# Текст сообщения: жёсткая граница до футера/реплая/инфо, чтобы не захватить лишнее;
# фолбэк — первый блок message_text, если структура иная.
_TEXT_RE = re.compile(
    r'tgme_widget_message_text[^>]*>(.*?)</div>\s*'
    r'<div class="tgme_widget_message_(?:footer|reply|info|forwarded)',
    re.S,
)
_TEXT_FALLBACK_RE = re.compile(r'tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', re.S)


# Служебные хвосты виджета telegram.me/s/ и рекламные футеры, не несущие смысла.
_NOISE_RE = re.compile(
    r"(Please open Telegram to view this post"
    r"|VIEW IN TELEGRAM"
    r"|🟩\s*Подписаться на RT:.*?(?:MAX|$)"
    r"|Подписаться на RT:[^\n]*)",
    re.I,
)
# Хвост со счётчиками реакций в конце баббла: эмодзи + число (1, 1.94K и т.п.), повторяется.
_REACT_TAIL_RE = re.compile(r"(?:\s+\S{1,2}\s+[\d.,]+[KM]?)+\s*$")


def _clean(text):
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = _NOISE_RE.sub(" ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    text = _REACT_TAIL_RE.sub("", text)
    return text.strip()


def _local_date_time(datetime_iso):
    parsed = dt.datetime.fromisoformat(datetime_iso.replace("Z", "+00:00"))
    local = parsed.astimezone()
    return local.date(), local.strftime("%H:%M")


def _parse_page(data_html):
    """
    Возвращает список (post_id_num, datetime_iso, text) со страницы telegram.me/s/.

    Двухшаговый разбор: режем страницу на бабблы по границе сообщения, затем из
    каждого баббла отдельно достаём data-post, datetime и текст. Так регексп не
    «перепрыгивает» через текстовый блок (частая ошибка одного жадного паттерна).
    """
    out = []
    for chunk in _BUBBLE_SPLIT_RE.split(data_html):
        mpost = _POST_RE.search(chunk)
        if not mpost:
            continue
        mdt = _DT_RE.search(chunk)
        if not mdt:
            continue
        mtext = _TEXT_RE.search(chunk) or _TEXT_FALLBACK_RE.search(chunk)
        text = _clean(mtext.group(1)) if mtext else ""

        post = mpost.group(1)
        num = None
        if "/" in post:
            tail = post.rsplit("/", 1)[-1]
            if tail.isdigit():
                num = int(tail)
        out.append((num, mdt.group(1), text))
    return out


def collect_scrape_channel(ch, target_date):
    """
    Собирает сообщения канала за target_date через telegram.me/s/ с пагинацией назад.
    Возвращает список (time_str, text), отсортированный по времени. Дедуп по post_id.
    """
    seen = set()
    collected = []  # (datetime_iso, time_str, text)
    before = None
    saw_older = False

    for _ in range(MAX_PAGES):
        rows = []
        last_err = None
        url = f"https://telegram.me/s/{ch}"
        for gap in range(BEFORE_GAP_RETRIES + 1):
            page_before = before - gap if before is not None else None
            if page_before is not None and page_before <= 0:
                break

            url = f"https://telegram.me/s/{ch}"
            if page_before is not None:
                url += f"?before={page_before}"

            for attempt in range(PAGE_RETRIES):
                try:
                    page = _http_get(url)
                    rows = _parse_page(page)
                    if rows:
                        if gap:
                            print(
                                f"WARNING: {ch}: skipped empty before={before}, continued from before={page_before}",
                                file=sys.stderr,
                            )
                        break
                    last_err = "no message rows parsed"
                except Exception as e:
                    last_err = e
                time.sleep(1.0 * (attempt + 1))

            if rows or before is None:
                break

        if not rows:
            print(
                f"WARNING: {ch}: stopped pagination at {url}: {last_err}",
                file=sys.stderr,
            )
            break

        min_num = None
        for num, dtv, text in rows:
            if num is not None:
                min_num = num if min_num is None else min(min_num, num)
            day, time_str = _local_date_time(dtv)
            if day == target_date:
                key = num if num is not None else (dtv, text[:40])
                if key in seen:
                    continue
                seen.add(key)
                if text:
                    collected.append((dtv, time_str, text))
            elif day < target_date:
                saw_older = True

        # Дошли до сообщений старше целевой даты — дальше листать назад смысла нет.
        if saw_older:
            break
        if min_num is None or min_num <= 1:
            break
        before = min_num
        time.sleep(0.6)

    collected.sort(key=lambda x: x[0])
    return [(t, txt) for _, t, txt in collected]


# --------------------------------------------------------------------------- #
# Оркестрация
# --------------------------------------------------------------------------- #
def render_category(category, channels, by_channel, source_map, target_date, metadata_map=None):
    lines = [f"# Сырьё новостей: {category} за {target_date.isoformat()}", ""]
    total = 0
    for ch in channels:
        msgs = by_channel.get(ch, [])
        total += len(msgs)
        src = source_map.get(ch, "scrape")
        metadata = [f"{len(msgs)} сообщений", f"источник: {src}"]
        channel_metadata = (metadata_map or {}).get(ch, {})
        group = channel_metadata.get("group")
        if group:
            metadata.append(f"группа: {group}")
        note = channel_metadata.get("note")
        if note:
            metadata.append(f"примечание: {note}")
        lines.append(f"CHANNEL: {ch} ({', '.join(metadata)})")
        if not msgs:
            lines.append("(нет сообщений за дату)")
        else:
            for tm, text in msgs:
                one = text.replace("\n", " ").strip()
                lines.append(f"[{tm}] {one}")
        lines.append("")
    return "\n".join(lines), total


def collect_category(category, channels, target_date, mtproto_data):
    """Объединяет MTProto-результаты (если есть) и скрапер для каждого канала."""
    by_channel = {}
    source_map = {}
    for ch in channels:
        msgs = None
        if mtproto_data and ch in mtproto_data:
            msgs = mtproto_data[ch]
            source_map[ch] = "mtproto"
        if not msgs:
            msgs = collect_scrape_channel(ch, target_date)
            source_map[ch] = "scrape"
        by_channel[ch] = msgs
    return by_channel, source_map


def iter_dates(date_from, date_to):
    cur = date_from
    while cur <= date_to:
        yield cur
        cur += dt.timedelta(days=1)


def parse_date_arg(value, name):
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"некорректная {name} '{value}', нужен YYYY-MM-DD")


def render_category_range(category, channels, blocks, date_from, date_to, metadata_map=None):
    if date_from == date_to:
        header = f"# Сырьё новостей: {category} за {date_from.isoformat()}"
    else:
        header = f"# Сырьё новостей: {category} за {date_from.isoformat()} — {date_to.isoformat()}"

    lines = [header, ""]
    total = 0
    for target_date, by_channel, source_map in blocks:
        if len(blocks) > 1:
            lines.extend([f"## Дата: {target_date.isoformat()}", ""])
        content, date_total = render_category(
            category,
            channels,
            by_channel,
            source_map,
            target_date,
            metadata_map,
        )
        body = content.split("\n", 2)[2] if "\n\n" in content else content
        lines.append(body.rstrip())
        lines.append("")
        total += date_total
    return "\n".join(lines).rstrip() + "\n", total


def main():
    parser = argparse.ArgumentParser(description="Единый сборщик новостей для /news")
    parser.add_argument("--date", help="Дата в формате YYYY-MM-DD")
    parser.add_argument("--date-from", help="Начальная дата диапазона в формате YYYY-MM-DD")
    parser.add_argument("--date-to", help="Конечная дата диапазона в формате YYYY-MM-DD")
    parser.add_argument(
        "--category",
        default="all",
        choices=["world", "crypto", "invest", "all"],
        help="Категория или all",
    )
    parser.add_argument(
        "--source",
        default="auto",
        choices=["auto", "scrape"],
        help="Источник сбора: auto пробует MTProto и падает на скрапер; scrape сразу использует telegram.me/s/",
    )
    args = parser.parse_args()

    if args.date and (args.date_from or args.date_to):
        print("ERROR: используй либо --date, либо --date-from/--date-to", file=sys.stderr)
        return 2

    try:
        if args.date:
            date_from = date_to = parse_date_arg(args.date, "дата")
        elif args.date_from and args.date_to:
            date_from = parse_date_arg(args.date_from, "date-from")
            date_to = parse_date_arg(args.date_to, "date-to")
        else:
            print("ERROR: нужен --date или пара --date-from/--date-to", file=sys.stderr)
            return 2
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    if date_from > date_to:
        print("ERROR: --date-from не может быть позже --date-to", file=sys.stderr)
        return 2

    all_channels = load_channels()
    cats = ["world", "crypto", "invest"] if args.category == "all" else [args.category]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    normalized_channels = {}
    metadata_maps = {}
    try:
        for cat in cats:
            normalized_channels[cat], metadata_maps[cat] = normalize_channel_specs(all_channels[cat])
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    wanted = sorted({c for cat in cats for c in normalized_channels[cat]})
    use_mtproto = args.source != "scrape" and date_from == date_to
    mtproto_data = None
    if args.source == "scrape":
        print("source=scrape: MTProto отключён → скрапер", file=sys.stderr)
    elif not use_mtproto:
        print("mtproto: диапазон дат → скрапер", file=sys.stderr)
    else:
        # MTProto-попытка один раз на все нужные каналы (одно подключение).
        creds = load_mtproto_creds()
        if creds:
            mtproto_data = collect_mtproto(wanted, date_from, creds)
            print(
                f"mtproto: {'OK, каналов с данными ' + str(len(mtproto_data)) if mtproto_data else 'недоступен → скрапер'}",
                file=sys.stderr,
            )
        else:
            print("mtproto: нет креденшелов → скрапер", file=sys.stderr)

    for cat in cats:
        channels = normalized_channels[cat]
        blocks = []
        for target_date in iter_dates(date_from, date_to):
            day_mtproto = mtproto_data if target_date == date_from else None
            by_channel, source_map = collect_category(cat, channels, target_date, day_mtproto)
            blocks.append((target_date, by_channel, source_map))
        content, total = render_category_range(
            cat,
            channels,
            blocks,
            date_from,
            date_to,
            metadata_maps[cat],
        )
        out_path = OUT_DIR / f"{cat}.md"
        out_path.write_text(content, encoding="utf-8")
        print(
            f"category={cat} channels={len(channels)} messages={total} "
            f"date_from={date_from.isoformat()} date_to={date_to.isoformat()} -> {out_path}"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
