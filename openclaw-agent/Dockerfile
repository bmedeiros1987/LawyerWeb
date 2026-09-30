FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g openclaw@latest

WORKDIR /opt/mblz
COPY plugin-mblz ./plugin-mblz
RUN cd /opt/mblz/plugin-mblz && npm pack --pack-destination /opt/mblz

COPY openclaw.json /opt/mblz/openclaw.template.json
COPY workspace /opt/mblz/workspace-template
COPY entrypoint.sh /usr/local/bin/mblz-openclaw-entrypoint
RUN chmod +x /usr/local/bin/mblz-openclaw-entrypoint

ENV OPENCLAW_GATEWAY_PORT=8080
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=/data/workspace
ENV OPENCLAW_CONFIG_PATH=/data/.openclaw/openclaw.json

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/mblz-openclaw-entrypoint"]
