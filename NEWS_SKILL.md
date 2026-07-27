---
name: news
description: Create English-language Telegram-based world, crypto, and investment news digests through the news server HTTP API. Use when the user invokes /news, /news-world, /news-crypto, or /news-invest; asks for the same behavior as the Claude Code news commands; requests digests saved to /tmp/world-news.md, /tmp/crypto-news.md, or /tmp/invest-news.md; or requests a world digest comparing Russian, Ukrainian, European, and American coverage of the Russian-Ukrainian conflict.
---

# News

## Purpose

Produce professional English-language `world`, `crypto`, and `invest` digests from Telegram messages collected by the news server.

Use the server HTTP routes for every remote operation. Do not run local collection, synchronization, or date-range scripts. Do not collect Telegram messages manually through MCP, MTProto, scraping, or web search.

## Server API

Before making any API request, ask the user for the news server URL and wait for
their response. Do this for every invocation, even when `NEWS_SERVER_URL` is set
or the local server appears to be available. Do not start a local server or
silently fall back to `http://127.0.0.1:5174`.

Use the URL provided by the user as `<SERVER_URL>`. Remove a trailing slash
before appending a route.

Valid categories are `world`, `crypto`, and `invest`.

| Action | Request |
|---|---|
| Read the latest digest | `GET <SERVER_URL>/api/digests/<CATEGORY>` |
| Start collection | `POST <SERVER_URL>/api/collections/<CATEGORY>` |
| Read job status | `GET <SERVER_URL>/api/collection-jobs/<JOB_ID>` |
| Download raw result | `GET <SERVER_URL>/api/collection-jobs/<JOB_ID>/result` |
| Publish a digest | `PUT <SERVER_URL>/api/digests/<CATEGORY>` |
| Check server health | `GET <SERVER_URL>/healthz` |

Use `curl` directly for every API request. Do not run `digest_server.py` or any
other local API wrapper. Require the expected HTTP status and reject empty
Markdown bodies.

### API contract

- Digest `GET`: expect `200` with `text/markdown`. A `404` with `Digest not found` is a valid first run.
- Collection `POST`: send `Content-Type: application/json` and body `{"dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD"}`. Expect `202` and a JSON job containing `id`.
- Job `GET`: expect JSON with `status` equal to `running`, `completed`, or `failed`; completed jobs can include `messages` and `summary`.
- Result `GET`: expect `200` with the exact raw Markdown only after the job is complete.
- Digest `PUT`: send the finished Markdown as the request body with `Content-Type: text/markdown; charset=utf-8`. Expect `200` JSON containing `category`, `bytes`, and `updatedAt`.

### `curl` examples

Replace the example URL with the server URL supplied by the user:

```bash
SERVER_URL='http://news.example:3001'
CATEGORY='world'

# Health check
curl --silent --show-error --include \
  "$SERVER_URL/healthz"

# Read the latest digest and print the HTTP status separately
curl --silent --show-error \
  --header 'Accept: text/markdown' \
  --output "/tmp/$CATEGORY-server-response.md" \
  --write-out '%{http_code}\n' \
  "$SERVER_URL/api/digests/$CATEGORY"

# Start collection
curl --silent --show-error --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"dateFrom":"2026-07-26","dateTo":"2026-07-26"}' \
  "$SERVER_URL/api/collections/$CATEGORY"

# Poll a job; replace JOB_ID with the id returned by the previous request
curl --silent --show-error --fail-with-body \
  "$SERVER_URL/api/collection-jobs/JOB_ID"

# Download the completed raw result
curl --silent --show-error --fail-with-body \
  --header 'Accept: text/markdown' \
  --output "/tmp/news-raw/$CATEGORY.md" \
  "$SERVER_URL/api/collection-jobs/JOB_ID/result"

# Publish the finished digest
curl --silent --show-error --fail-with-body \
  --request PUT \
  --header 'Content-Type: text/markdown; charset=utf-8' \
  --data-binary "@/tmp/$CATEGORY-news.md" \
  "$SERVER_URL/api/digests/$CATEGORY"
```

Stop the affected category on unexpected HTTP responses. Treat `429` from collection start as a busy server and report it. On a failed job, report the server's `error`. Poll running jobs with short waits, allow up to 30 minutes in total, and keep the user updated during long collections.

## Language and sources

Return all user-facing text and every saved digest in English. Translate source material and all required headings, labels, table headers, placeholders, and disclaimers into natural English.

Read `/Users/i-khovanskiy/home/news/prompts/<CATEGORY>.md` for the authoritative content requirements, section order, tables, and analytical constraints. The English-language rule in this skill overrides the templates' Russian-language instruction.

Use only `/tmp/news-raw/<CATEGORY>.md` as factual source data for analysis. Do not invent facts absent from the raw result.

`channels.json` on the server is authoritative for channel membership and source groups. For `world`, preserve every `group` and `note` emitted in the raw `CHANNEL` headers. Valid groups are `russian`, `ukrainian`, `european`, and `american`; never reclassify channels.

## Category choice

For a generic `/news` request, ask and wait:

```text
Which type of news should I collect?
world
crypto
invest
all
```

For `news-world`, `news-crypto`, or `news-invest`, use the explicit category without asking. For `all`, process `world`, `crypto`, and `invest` separately because their date ranges can differ.

## Date-range resolution

Resolve the range independently for every selected category:

1. Request the latest digest with `GET /api/digests/<CATEGORY>`.
2. On `200`, require a non-empty Markdown body and save that exact body to both `/tmp/<CATEGORY>-news.md` and `/tmp/<CATEGORY>.md`.
3. Inspect the first 20 lines of the server response. Find the first Markdown heading containing ISO dates matching `20\d{2}-\d{2}-\d{2}` and use the last date in that heading as `last_date`. A range heading therefore uses its end date.
4. On a valid `404`, treat the digest as missing and ignore any stale local digest copies. Set `last_date` to none.
5. Set `date_to` to yesterday in the news server's timezone. Set `date_from` to the day after `last_date`; if no date was found, set it to `date_to`.
6. If `date_from` is later than `date_to`, mark the category `up_to_date` and do not collect, analyze, or publish it.

Never repeat an already generated calendar day. Stop the category if the digest request fails for any reason other than the valid missing-digest response.

## Workflow

For every selected category whose range is ready:

1. Start collection with `POST /api/collections/<CATEGORY>` using the resolved inclusive range.
2. Read `id` from the `202` response.
3. Poll `GET /api/collection-jobs/<JOB_ID>` until:
   - `completed`: record `messages` and `summary`, then continue;
   - `failed`: stop and report `error`;
   - 30 minutes elapse: stop and report a timeout.
4. Download `GET /api/collection-jobs/<JOB_ID>/result`. Save the exact non-empty response to `/tmp/news-raw/<CATEGORY>.md`.
5. Read the matching prompt template and the raw result. Produce the report in English, following the template's structure exactly. Use `YYYY-MM-DD` in the date field for one day or `YYYY-MM-DD — YYYY-MM-DD` for a multi-day range.
6. Save identical report content to:
   - `world`: `/tmp/world-news.md` and `/tmp/world.md`
   - `crypto`: `/tmp/crypto-news.md` and `/tmp/crypto.md`
   - `invest`: `/tmp/invest-news.md` and `/tmp/invest.md`
7. Publish `/tmp/<CATEGORY>-news.md` with `PUT /api/digests/<CATEGORY>`.
8. Claim publication success only after the server returns the expected `200` response. If publishing fails, keep both completed local files and report that the server is not current.

Publish only categories generated during the current run. Do not publish an `up_to_date` category or a category whose collection or analysis failed.

## Analysis requirements

### World

Act as a professional political scientist and economist.

Compare where reports about the Russian-Ukrainian conflict converge or diverge across source groups. Compare only the same event or process over a comparable period:

- Convergence requires at least two different groups to confirm a shared factual core.
- Divergence requires a difference in facts, causality, responsibility, scale, consequences, or evaluative language.
- Absence of coverage is not divergence.
- Name the groups and channels supporting each comparison.
- State explicitly when a group has insufficient data.
- Do not add a separate rhetoric-by-source-group section.

### Crypto

Act as a professional financier, economist, investor, and cryptocurrency specialist. Do not invent prices, tickers, targets, or events absent from the raw result.

### Invest

Act as a professional financier, economist, and investor. Do not invent facts, quotes, prices, or tickers absent from the raw result.

## Channel maintenance

When adding or replacing entries in `channels.json`:

- Verify the current public Telegram subscriber count and require at least 20,000 subscribers.
- Require an official newsroom account or a transparent relay that links directly to a legitimate newsroom.
- Prefer the source country's local language.
- Leave a country unrepresented rather than using a smaller, anonymous, or propagandistic substitute.
- Record country, language, official or relay status, and editorial caveats in `note`.

## Completion report

Report:

- selected categories;
- resolved date range or `up_to_date` status for each;
- collected message counts;
- created local files;
- publication status for each generated category.

Keep facts, interpretation, and forecasts distinct. Attribute disputed claims and avoid unsupported certainty.
