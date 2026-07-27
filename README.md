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

The `/news` helper also defaults to `http://127.0.0.1:5174`. Set
`NEWS_SERVER_URL` only when it should use a deployed server instead.

## API

- `GET /api/digests/:category` returns the latest Markdown digest.
- `PUT /api/digests/:category` publishes a Markdown digest.
- `POST /api/collections/:category` starts `collect.py` on the server.
- `GET /api/collection-jobs/:id` returns collection status.
- `GET /api/collection-jobs/:id/result` returns completed raw Markdown.
- `GET /healthz` is a health check.

Valid categories are `world`, `crypto`, and `invest`. Local digests are stored
in `./data`. Collection jobs are asynchronous, and one job can run at a time.

The write and collection routes intentionally have no authentication. Anyone
who can reach them can overwrite a digest or start a collection.

## `/news` helper

The helper pulls the previous digest, requests collection on the same SvelteKit
server, downloads the raw result for analysis, and publishes the finished
digest:

```bash
python3 digest_server.py pull world
python3 digest_server.py collect world --date-from 2026-07-26 --date-to 2026-07-26
python3 digest_server.py push world
```

For production, configure only the server URL:

```bash
export NEWS_SERVER_URL="https://news.example.com"
```

## Production

```bash
npm run build
npm start
```

Or deploy with Docker:

```bash
docker compose up -d --build
```

The Docker deployment listens on port `3000`, stores digests in the persistent
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
