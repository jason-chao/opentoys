#!/usr/bin/env bash
# Deploy origin/main to a server over SSH: pull, rebuild the container, wait until it is healthy.
#   deploy/docker/deploy.sh user@host [public-url]
# The server needs git, Docker with compose, and a clone of this repository in ~/opentoys (made on first run).
set -euo pipefail

HOST="${1:?usage: deploy.sh user@host [public URL]}"
URL="${2:-}"
REPO="$(git config --get remote.origin.url)"

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
if [ ! -d ~/opentoys/.git ]; then git clone "$REPO" ~/opentoys; fi
cd ~/opentoys
git fetch --quiet origin
git checkout --quiet main
git reset --hard --quiet origin/main
git log -1 --format='deploying %h %s'
docker compose -f deploy/docker/compose.yaml up -d --build
for i in \$(seq 1 30); do
	status=\$(docker inspect -f '{{.State.Health.Status}}' opentoys)
	[ "\$status" = healthy ] && break
	sleep 2
done
echo "container: \$status"
[ "\$status" = healthy ]
curl -fsS -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:8003/en/
REMOTE

if [ -n "$URL" ]; then
	echo "public:"
	curl -fsSI "$URL/en/" | grep -iE '^(HTTP|content-security-policy|permissions-policy|cache-control|x-robots-tag)'
fi
