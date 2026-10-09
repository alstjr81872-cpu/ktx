FROM node:24-bookworm-slim AS node
FROM python:3.12-slim-bookworm AS base
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY requirements-korail.lock requirements.txt ./
COPY scripts/setup-korail.mjs scripts/setup-korail.mjs
RUN npm run setup:korail
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production PORT=10000
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/.venv ./.venv
COPY --from=build --chown=node:node /app/next.config.ts ./
COPY --from=build --chown=node:node /app/scripts/korail-worker.py ./scripts/korail-worker.py
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
EXPOSE 10000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
