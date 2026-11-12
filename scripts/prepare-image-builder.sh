#!/usr/bin/env bash
# Install only the CLI; use the Docker endpoint already supplied by the runner.
set -euo pipefail
if ! command -v docker >/dev/null || ! docker buildx version >/dev/null 2>&1; then
  . /etc/os-release
  case "$ID" in
    debian|ubuntu) ;;
    *) echo 'This runner needs Docker CLI and Buildx preinstalled.' >&2; exit 1 ;;
  esac
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/nepos-docker.asc
  chmod a+r /etc/apt/keyrings/nepos-docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nepos-docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" > /etc/apt/sources.list.d/nepos-docker.list
  apt-get update
  apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin
fi
docker info >/dev/null
docker buildx version
