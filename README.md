# News digests

A SvelteKit + TypeScript application that serves the digest viewer, API routes,
and server-side Telegram collector from one Node process.

## Local development

Requirements: Node.js 22+ and Python 3.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5174>. That single command starts the UI, digest API, and
collection API. `collect.py` starts automatically on demand; no second server
process or environment variables are needed.

## API

- `GET /api/digests/:category` returns the latest Markdown digest.
- `PUT /api/digests/:category` publishes a Markdown digest.
- `POST /api/collections/:category` cancels any running collector and starts a
  new `collect.py` job on the server.
- `GET /api/collection-jobs/:id` returns collection status.
- `GET /api/collection-jobs/:id/result` returns completed raw Markdown.
- `GET /healthz` is a health check.

Valid categories are `world`, `crypto`, and `invest`. Local digests are stored
in `./data`. Collection jobs are asynchronous, and one job can run at a time.

The write and collection routes intentionally have no authentication. Anyone
who can reach them can overwrite a digest or start a collection.

## `/news` workflow

The `/news` skill talks directly to the SvelteKit server over HTTP. For example:

```bash
SERVER_URL='http://news.example:3001'

curl --silent --show-error \
  "$SERVER_URL/api/digests/world"

curl --silent --show-error --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"dateFrom":"2026-07-26","dateTo":"2026-07-26"}' \
  "$SERVER_URL/api/collections/world"

curl --silent --show-error --fail-with-body \
  --request PUT \
  --header 'Content-Type: text/markdown; charset=utf-8' \
  --data-binary '@/tmp/world-news.md' \
  "$SERVER_URL/api/digests/world"
```

The skill asks for the server URL on every invocation.

## Production

```bash
npm run build
npm start
```

Or deploy with Docker:

```bash
docker compose up -d --build
```

The Docker deployment listens on port `3001`, stores digests in the persistent
`news-data` volume, and runs collection in the `Europe/Moscow` timezone.
Override the public bind address or port with `NEWS_BIND_ADDRESS` and
`NEWS_PORT`.

To deploy over SSH with the project-local Codex skill, invoke
`$deploy-news-server`. It asks for a server destination before connecting and
deploys through Docker Compose without copying local data or secrets.

## Verification

```bash
npm run check
npm test
npm run build
```
