# syntax=docker/dockerfile:1

# Image de FEUX FRANCE. Node 22 (et pas 24) : c'est la version de dev et celle
# pour laquelle `better-sqlite3` publie des prebuilds testés — une compilation
# native de secours coûte plusieurs minutes de build pour rien.

########################  dépendances  ########################
# BEGIN security tooling builders
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS security-npm-tooling
RUN npm install --global npm@12.2.1 \
 && mkdir /patched-undici \
 && cd /patched-undici \
 && npm init -y \
 && npm install --ignore-scripts undici@6.29.1 ip-address@10.3.1 \
 && rm -rf /usr/local/lib/node_modules/npm/node_modules/undici /usr/local/lib/node_modules/npm/node_modules/ip-address \
 && cp -R node_modules/undici /usr/local/lib/node_modules/npm/node_modules/undici \
 && cp -R node_modules/ip-address /usr/local/lib/node_modules/npm/node_modules/ip-address \
 && npm cache clean --force
RUN mkdir /fixture && cd /fixture \
 && printf '%s\n' '{"name":"offline-security-fixture","version":"1.0.0","private":true,"scripts":{"start":"node -e \"console.log(42)\""}}' > package.json \
 && npm install --package-lock-only --ignore-scripts --no-audit \
 && npm ci --ignore-scripts --no-audit \
 && npm run start \
 && npm pack --ignore-scripts --dry-run \
 && test "$(npm --version)" = 12.2.1
# END security tooling builders

FROM node:22.23.4-bookworm-slim AS deps
WORKDIR /app
# Repli si `prebuild-install` ne trouve pas de binaire pour cette ABI.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

########################  build Next  ########################

# BEGIN runtime security hardening
USER root
RUN if command -v apk >/dev/null 2>&1; then apk upgrade --no-cache; \
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*; fi \
    && rm -rf /usr/local/lib/node_modules/npm
COPY --from=security-npm-tooling /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
USER root
# END runtime security hardening

FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Toutes les routes portent `force-dynamic` : aucun accès à la base pendant le
# build, la base n'a donc pas besoin d'être montée ici.
RUN npm run build

########################  runner app  ########################

# BEGIN runtime security hardening
USER root
RUN if command -v apk >/dev/null 2>&1; then apk upgrade --no-cache; \
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*; fi \
    && rm -rf /usr/local/lib/node_modules/npm
COPY --from=security-npm-tooling /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
USER root
# END runtime security hardening

FROM node:22.23.4-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Les quatre lignes qui suivent recopient ce que le tracing de Next embarque
# DÉJÀ aujourd'hui (vérifié sur ce projet) : elles sont un filet, pas un
# complément. Le tracing ne suit pas les chemins construits à l'exécution
# (`bindings()` pour better-sqlite3) et son résultat dépend de la config — une
# régression silencieuse ici donne une app qui démarre puis meurt au premier
# accès à la base, ou une carte sans aucun trait de frontière (GeoJSON en 404).
# Recopier des fichiers identiques ne coûte rien ; les découvrir absents en
# production, si.
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build /app/node_modules/bindings ./node_modules/bindings
COPY --from=build /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Point de montage du volume persistant. `src/lib/db.ts` ouvre la base dans
# `process.cwd()/data`, soit /app/data ici.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000
CMD ["node", "server.js"]

########################  cron de mise à jour  ########################
# `scripts/update.mjs` n'utilise que le `fetch` global : pas de node_modules,
# donc une image nue suffit.

# BEGIN runtime security hardening
USER root
RUN if command -v apk >/dev/null 2>&1; then apk upgrade --no-cache; \
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*; fi \
    && rm -rf /usr/local/lib/node_modules/npm
COPY --from=security-npm-tooling /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
USER node
# END runtime security hardening

FROM node:22.23.4-bookworm-slim AS cron
WORKDIR /app
ENV NODE_ENV=production
COPY scripts ./scripts
COPY docker/update-cron.sh /usr/local/bin/update-cron.sh
RUN chmod +x /usr/local/bin/update-cron.sh
USER node
CMD ["/usr/local/bin/update-cron.sh"]

# Autonomous OMNI collector and online backup tools. Same persistent volume as FEUX.

# BEGIN runtime security hardening
USER root
RUN if command -v apk >/dev/null 2>&1; then apk upgrade --no-cache; \
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*; fi \
    && rm -rf /usr/local/lib/node_modules/npm
COPY --from=security-npm-tooling /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
USER node
# END runtime security hardening

FROM deps AS omni-worker
WORKDIR /app
ENV NODE_ENV=production
COPY src/lib/omni ./src/lib/omni
COPY scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
CMD ["node", "scripts/omni-worker.mjs", "--daemon"]

# BEGIN runtime security hardening
USER root
RUN if command -v apk >/dev/null 2>&1; then apk upgrade --no-cache; \
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*; fi \
    && rm -rf /usr/local/lib/node_modules/npm
COPY --from=security-npm-tooling /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
USER node
# END runtime security hardening
