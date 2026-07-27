---
name: deploy-news-server
description: Deploy this news-digest project to a user-provided Linux server over SSH with Docker Compose, persistent data, and health verification. Use when the user asks to deploy, publish, redeploy, update, or run this project on their own server, VPS, IP address, or SSH host.
---

# Deploy News Server

Deploy the current project as a non-root container. Keep digest data in the
Docker named volume and retain release directories for manual rollback.

## Require the destination

If the user has not supplied a server in the current request or conversation,
ask:

> What server should I deploy to? Send its IP or hostname, preferably as
> `user@host`, and mention the SSH port if it is not 22.

End the turn after asking. Do not infer, discover, reuse an unrelated host, or
run any SSH command without an explicit destination from the user.

Accept an IPv4 address, hostname, or `user@host`. If only an IP/hostname is
given, let SSH use its configured/default username. Treat the supplied
destination as authorization to connect and perform this deployment. Ask only
when the destination is missing or genuinely ambiguous.

## Validate locally

From the project root:

1. Inspect the current changes and preserve unrelated user work.
2. Run `npm run check`, `npm test`, and
   `docker build -t news-digests:deploy-check .`.
3. Stop and report actionable failures. Do not deploy a failed build.

Do not require local Docker Compose; the server preflight checks Compose v2.

## Deploy

Run the bundled script from the project root, using a PTY so SSH can handle a
new host key or password:

```bash
bash .codex/skills/deploy-news-server/scripts/deploy.sh <destination> [ssh-port] [http-port]
```

Request network/sandbox approval when the execution environment requires it.
The script must:

- Preflight SSH, Docker Engine, and Docker Compose v2.
- Upload only container build inputs to a new `.news-deploy/releases/<id>`
  directory in the remote user's home.
- Build and recreate the `news` Compose project.
- Preserve the `news_news-data` named volume across releases.
- Wait for the container health check and update `.news-deploy/current`.

Do not automatically install Docker, change firewall/SSH configuration, upload
local `data`, copy credentials, prune Docker state, or delete old releases. If
Docker is absent or inaccessible, report the exact preflight failure and ask
the user how to proceed.

The app is exposed on `http://<host>:3000` by default. Select a different
`http-port` when that port is occupied; do not stop or replace an unrelated
service. Its write and collection routes are unauthenticated; state this
clearly in the handoff and recommend a firewall or authenticated reverse proxy
before public exposure.

## Verify and report

After the script succeeds:

1. Check `http://<host>:3000/healthz` from the local machine when reachable.
2. Report the destination, release ID, container health, URL, and persistent
   volume.
3. If the external check fails but remote container health is good, distinguish
   an application failure from likely firewall/network reachability.
