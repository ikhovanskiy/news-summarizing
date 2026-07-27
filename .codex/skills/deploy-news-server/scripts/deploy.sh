#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s <[user@]host> [ssh-port] [http-port]\n' "$0" >&2
}

if (( $# < 1 || $# > 3 )); then
  usage
  exit 64
fi

destination=$1
ssh_port=${2:-22}
http_port=${3:-3001}

if [[ -z "$destination" || "$destination" == -* || "$destination" =~ [[:space:]] ]]; then
  printf 'Invalid SSH destination: %q\n' "$destination" >&2
  exit 64
fi
if [[ ! "$ssh_port" =~ ^[0-9]+$ ]] || (( ssh_port < 1 || ssh_port > 65535 )); then
  printf 'Invalid SSH port: %q\n' "$ssh_port" >&2
  exit 64
fi
if [[ ! "$http_port" =~ ^[0-9]+$ ]] || (( http_port < 1 || http_port > 65535 )); then
  printf 'Invalid HTTP port: %q\n' "$http_port" >&2
  exit 64
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
release_id="$(date -u '+%Y%m%dT%H%M%SZ')-$(printf '%05d' "$RANDOM")"
remote_release=".news-deploy/releases/$release_id"
archive=$(mktemp "${TMPDIR:-/tmp}/news-deploy.XXXXXX")
cleanup() {
  rm -f -- "$archive"
}
trap cleanup EXIT

required_paths=(
  Dockerfile
  compose.yaml
  .dockerignore
  package.json
  package-lock.json
  svelte.config.js
  vite.config.ts
  tsconfig.json
  src
  public
  collect.py
  channels.json
)

for required_path in "${required_paths[@]}"; do
  if [[ ! -e "$project_root/$required_path" ]]; then
    printf 'Required deployment input is missing: %s\n' "$required_path" >&2
    exit 66
  fi
done

printf 'Creating release archive %s\n' "$release_id"
tar -C "$project_root" -czf "$archive" "${required_paths[@]}"

ssh_options=(
  -p "$ssh_port"
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)

printf 'Checking Docker on %s\n' "$destination"
ssh "${ssh_options[@]}" -- "$destination" \
  'command -v bash >/dev/null && docker --version && if docker info >/dev/null 2>&1; then docker compose version; elif sudo -n docker info >/dev/null 2>&1; then sudo -n docker compose version; else echo "Docker is not accessible by this user or passwordless sudo." >&2; exit 1; fi'

printf 'Uploading release %s\n' "$release_id"
ssh "${ssh_options[@]}" -- "$destination" \
  "mkdir -p '$remote_release' && tar -xzf - -C '$remote_release'" \
  < "$archive"

printf 'Building and starting release %s\n' "$release_id"
ssh "${ssh_options[@]}" -- "$destination" \
  "bash -s -- '$remote_release' '$release_id' '$http_port'" <<'REMOTE'
set -Eeuo pipefail
release_dir=$1
release_id=$2
http_port=$3

docker_command=(docker)
if ! docker info >/dev/null 2>&1; then
  docker_command=(sudo -n docker)
fi

cd "$release_dir"
printf 'NEWS_PORT=%s\n' "$http_port" > .env
"${docker_command[@]}" compose -p news up -d --build --remove-orphans

container_id=$("${docker_command[@]}" compose -p news ps -q news)
if [[ -z "$container_id" ]]; then
  printf 'Compose did not return a container ID for the news service.\n' >&2
  exit 1
fi

health=starting
for (( attempt = 1; attempt <= 40; attempt++ )); do
  health=$("${docker_command[@]}" inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id")
  case "$health" in
    healthy|running)
      break
      ;;
    unhealthy|exited|dead)
      "${docker_command[@]}" compose -p news logs --tail=100 news >&2
      exit 1
      ;;
  esac
  sleep 3
done

if [[ "$health" != healthy && "$health" != running ]]; then
  printf 'Container did not become healthy; final state: %s\n' "$health" >&2
  "${docker_command[@]}" compose -p news logs --tail=100 news >&2
  exit 1
fi

cd ../..
ln -sfn "releases/$release_id" current
printf 'release=%s container=%s health=%s port=%s volume=news_news-data\n' \
  "$release_id" "$container_id" "$health" "$http_port"
REMOTE

printf 'Deployment complete: release=%s url=http://%s:%s\n' \
  "$release_id" "${destination#*@}" "$http_port"
