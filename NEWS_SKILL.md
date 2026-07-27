---
name: news
description: Use this skill when the user invokes /news, /news-world, /news-crypto, or /news-invest; asks for the same behavior as the Claude Code news commands; wants English-language Telegram-based world, crypto, and investment news digests saved to /tmp/world-news.md, /tmp/crypto-news.md, and /tmp/invest-news.md; or wants a world digest comparing Russian, Ukrainian, European, and American coverage of the Russian-Ukrainian conflict.
---

# News

## Purpose

Produce professional English-language news digests from Telegram channels: world news, crypto, and investments. Preserve the behavior of the user's Claude Code `/news` command, with an interactive category choice before collection.

For `world`, compare where Russian, Ukrainian, European, and American coverage of the Russian-Ukrainian conflict converges or diverges. Do not produce a separate rhetoric-by-source-group section.

## Output Language

Return all user-facing text and every saved digest in English. Translate source material as needed.

This is a hard invariant and overrides any Russian-language requirement in
`/Users/i-khovanskiy/home/news/prompts/*.md`. Treat those prompt templates as authoritative for
content requirements, section order, tables, and analytical constraints, but translate every
heading, label, table header, placeholder, and disclaimer into natural English. Do not retain
Russian headings in the finished report.

## Deterministic Pipeline

The data collection and report formats are defined in `/Users/i-khovanskiy/home/news/`.
Do not collect Telegram messages manually through MCP tools, do not use Telegram MCP/MTProto, and do not invent a custom report format. The deployed server must execute the existing collector script in scraper-only mode. Use the sync helper to request server-side collection and download its exact raw result; never run `collect.py` locally. Use the prompt templates so every run uses the same summarization pipeline.

The news server is the canonical store for completed digests. The sync helper defaults to the
local SvelteKit development server at `http://127.0.0.1:5174`; `NEWS_SERVER_URL` overrides it
for a deployed server. For every selected category, pull the previous digest before resolving
its date range and publish the new digest after generating it. Use only the project sync helper:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py pull <CATEGORY>
python3 /Users/i-khovanskiy/home/news/digest_server.py collect <CATEGORY> --date-from <DATE_FROM> --date-to <DATE_TO>
python3 /Users/i-khovanskiy/home/news/digest_server.py push <CATEGORY>
```

A pull with `status=missing` is a valid first run. Any other pull failure must stop processing
that category, because a local digest may be stale and cannot safely determine the next range.
If publishing fails, keep the completed local files and report the publication failure explicitly;
do not claim that the server is current.

`channels.json` is authoritative for channel membership and source groups. `world` entries use objects with `name`, `group`, and an optional `note`; valid groups are `russian`, `ukrainian`, `european`, and `american`. Do not reclassify channels during analysis. The collector copies the group and note into each `CHANNEL` header in `/tmp/news-raw/world.md`. Preserve notes such as an unofficial-relay warning in the report.

## Channel Selection

When adding or replacing channels in `channels.json`:

- Verify the current public Telegram subscriber count and require at least 20,000 subscribers.
- Require an official newsroom account or a transparent relay that links directly to a legitimate newsroom. Never trade source legitimacy for subscriber count.
- Prefer the source country's local language. If no qualifying channel exists for a country, leave that country temporarily unrepresented instead of adding a smaller, anonymous, or propagandistic substitute.
- Record the country, language, official/relay status, and relevant editorial caveats in `note`.
- Recheck the subscriber count whenever editing channel membership; counts do not need to be checked on every digest run.

## Category Choice

Before collecting anything for a generic `/news` invocation, ask the user which type to collect and wait for the answer:

```text
Which type of news should I collect?
world
crypto
invest
all
```

If the user explicitly invokes `news-world`, `news-crypto`, or `news-invest`, use that category directly without asking again. If the user chooses `all`, process `world`, `crypto`, and `invest`.

## Date Range Resolution

For each selected category, first pull the canonical previous digest, then resolve the catch-up
range before collection:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py pull <CATEGORY>
python3 /Users/i-khovanskiy/home/news/resolve_range.py <CATEGORY>
```

The helper reads the last generated digest date from `/tmp/<CATEGORY>.md` first and `/tmp/<CATEGORY>-news.md` second, then returns:

```text
category=<CATEGORY> status=<STATUS> date_from=<DATE_FROM> date_to=<YESTERDAY_DATE> last_date=<LAST_DATE> source=<SOURCE_FILE>
```

Use `date_from` and `date_to` from that output only when `status=ready`. The range is inclusive and starts on the calendar day **after** the last date found in the prior digest, so an already generated day is never repeated. It ends at yesterday in local time. If no prior digest exists, the helper returns yesterday as both `date_from` and `date_to`.

If `status=up_to_date`, do not run the collector or analysis for that category. Report that there are no unprocessed dates through yesterday. Never clamp an empty range back to yesterday, because that would repeat an already generated digest.

## `/news` Workflow

1. Ask the category-choice question above unless the category is already explicit.

2. For each selected category, pull the previous digest from the server and then resolve the range:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py pull <CATEGORY>
python3 /Users/i-khovanskiy/home/news/resolve_range.py <CATEGORY>
```

If pull fails for any reason other than the helper's successful `status=missing` result, stop that
category. If the resolver has `status=up_to_date`, skip the remaining steps and report it as current.

3. Ask the deployed server to execute `collect.py` for that category over the resolved inclusive
range, replacing `<DATE_FROM>` and `<DATE_TO>`:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py collect <CATEGORY> --date-from <DATE_FROM> --date-to <DATE_TO>
```

The helper starts an asynchronous server collection job, waits for it, downloads the exact raw
Markdown, and writes it locally for analysis. The server-side collector reads its deployed
`channels.json`, skips Telegram MCP/MTProto entirely, and uses public `telegram.me/s/` previews.
The downloaded raw data is written to:

- `/tmp/news-raw/world.md`
- `/tmp/news-raw/crypto.md`
- `/tmp/news-raw/invest.md`

For `world`, preserve the `group` marker emitted in every `CHANNEL` header. The canonical world prompt uses it for the cross-source comparison of the Russian-Ukrainian conflict.

Remember the server's collected message counts forwarded by the helper, especially lines like:

```text
category=crypto channels=12 messages=144 date_from=2026-06-23 date_to=2026-06-23 ...
```

If the user chose `all`, resolve each category separately because their last generated dates can differ. Collect only categories whose resolver returned `status=ready`.

4. Analyze the selected categories. Give each analysis task exactly this instruction, replacing `<CATEGORY>` with `world`, `crypto`, or `invest` and `<DATE_RANGE>` with either a single date or `YYYY-MM-DD — YYYY-MM-DD`:

```text
Read `/Users/i-khovanskiy/home/news/prompts/<CATEGORY>.md` and follow its content requirements,
section order, tables, and analytical constraints exactly.
Use ONLY `/tmp/news-raw/<CATEGORY>.md` as source data. Read it.
Do NOT collect data yourself and do NOT invent facts absent from the file.
Write the entire report in English. This language rule overrides the template's Russian-language
instruction. Translate all required headings, labels, table headers, and disclaimers into English
while preserving their order and structure. Use `<DATE_RANGE>` in the date field.
For world, use the groups from CHANNEL headers; do not classify channels yourself.
For world, do not add a separate rhetoric-by-source-group section. Compare where the meaning of
reports about the Russian-Ukrainian conflict converges and diverges across the four groups.
Save the result to `/tmp/<CATEGORY>-news.md` and duplicate the same result to
`/tmp/<CATEGORY>.md` (world -> /tmp/world-news.md and /tmp/world.md,
crypto -> /tmp/crypto-news.md and /tmp/crypto.md,
invest -> /tmp/invest-news.md and /tmp/invest.md).
```

If sub-agent tooling is unavailable or the user did not explicitly ask for sub-agents, perform the analyses yourself sequentially using the same templates and raw files.

5. Publish each newly generated digest:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py push <CATEGORY>
```

Publish only categories generated in this run. Do not publish a category that was `up_to_date`,
whose collection or analysis failed, or whose output file is empty.

6. Finish by reporting:

- selected category/categories;
- date range for each category;
- collected message counts;
- created files;
- publication status for each generated category.

## Single-Category Workflows

Use these when the user invokes or asks for the equivalent of Claude commands `news-world`, `news-crypto`, or `news-invest`.

### `news-world`

Role: professional political scientist and economist.

1. Pull the server digest and resolve the range:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py pull world
python3 /Users/i-khovanskiy/home/news/resolve_range.py world
```

If pull fails, stop. If the resolver returns `status=up_to_date`, stop and report that no world
dates remain to process.

2. Run collection on the deployed server and download its raw result:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py collect world --date-from <DATE_FROM> --date-to <DATE_TO>
```

3. Read `/Users/i-khovanskiy/home/news/prompts/world.md` and follow its content requirements and structure exactly.
Render the entire digest in English, translating all headings and labels; this overrides the template's Russian-language instruction.
Use only `/tmp/news-raw/world.md` as source data. Do not invent facts that are absent from the file.
Use only the source-group labels recorded in `CHANNEL` headers. Do not add a separate rhetoric-by-source-group section. Include the convergence/divergence analysis required by the prompt.
Save the result to `/tmp/world-news.md` and `/tmp/world.md`.

4. Publish only after both local files have been created successfully:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py push world
```

### `news-crypto`

Role: professional financier, economist, investor, and cryptocurrency specialist.

1. Pull the server digest and resolve the range:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py pull crypto
python3 /Users/i-khovanskiy/home/news/resolve_range.py crypto
```

If pull fails, stop. If the resolver returns `status=up_to_date`, stop and report that no crypto
dates remain to process.

2. Run collection on the deployed server and download its raw result:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py collect crypto --date-from <DATE_FROM> --date-to <DATE_TO>
```

3. Read `/Users/i-khovanskiy/home/news/prompts/crypto.md` and follow its content requirements and structure exactly.
Render the entire digest in English, translating all headings, table headers, and the disclaimer; this overrides the template's Russian-language instruction.
Use only `/tmp/news-raw/crypto.md` as source data. Do not invent facts, prices, or tickers that are absent from the file.
Save the result to `/tmp/crypto-news.md` and `/tmp/crypto.md`.

4. Publish only after both local files have been created successfully:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py push crypto
```

### `news-invest`

Role: professional financier, economist, and investor.

1. Pull the server digest and resolve the range:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py pull invest
python3 /Users/i-khovanskiy/home/news/resolve_range.py invest
```

If pull fails, stop. If the resolver returns `status=up_to_date`, stop and report that no investment
dates remain to process.

2. Run collection on the deployed server and download its raw result:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py collect invest --date-from <DATE_FROM> --date-to <DATE_TO>
```

3. Read `/Users/i-khovanskiy/home/news/prompts/invest.md` and follow its content requirements and structure exactly.
Render the entire digest in English, translating all headings, table headers, and the disclaimer; this overrides the template's Russian-language instruction.
Use only `/tmp/news-raw/invest.md` as source data. Do not invent facts, quotes, or tickers that are absent from the file.
Save the result to `/tmp/invest-news.md` and `/tmp/invest.md`.

4. Publish only after both local files have been created successfully:

```bash
python3 /Users/i-khovanskiy/home/news/digest_server.py push invest
```

## Style

- Write in English.
- Be concise but analytical.
- Separate facts from interpretation and forecasts.
- Attribute disputed claims to their channels and source groups.
- Avoid unsupported certainty, especially for market predictions.
- Preserve the markdown format from the selected prompt template exactly.
