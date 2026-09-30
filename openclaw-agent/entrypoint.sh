#!/bin/sh
set -eu

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}"
PORT="${OPENCLAW_GATEWAY_PORT:-8080}"

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

if [ ! -f "$CONFIG_PATH" ]; then
  cp /opt/mblz/openclaw.template.json "$CONFIG_PATH"
fi

for file in IDENTITY.md AGENTS.md; do
  if [ ! -f "$WORKSPACE_DIR/$file" ]; then
    cp "/opt/mblz/workspace-template/$file" "$WORKSPACE_DIR/$file"
  fi
done

chown -R node:node "$STATE_DIR" "$WORKSPACE_DIR"

PLUGIN_TGZ="$(find /opt/mblz -maxdepth 1 -name '*.tgz' | head -n 1)"
if [ -n "$PLUGIN_TGZ" ]; then
  gosu node openclaw plugins install "npm-pack:$PLUGIN_TGZ" --force >/tmp/mblz-plugin-install.log 2>&1 || {
    cat /tmp/mblz-plugin-install.log >&2
    exit 1
  }
fi

if [ "${OPENCLAW_INSTALL_WHATSAPP_PLUGIN:-true}" = "true" ]; then
  gosu node openclaw plugins install @openclaw/whatsapp --force >/tmp/whatsapp-plugin-install.log 2>&1 || {
    cat /tmp/whatsapp-plugin-install.log >&2
    exit 1
  }
fi

exec gosu node openclaw gateway --allow-unconfigured --port "$PORT"
