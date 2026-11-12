FROM node:24-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts && npm rebuild esbuild
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY scripts/single-file.mjs ./scripts/single-file.mjs
COPY public ./public
RUN npm run build

FROM php:8.4-fpm-alpine AS runtime
RUN apk add --no-cache nginx supervisor curl && addgroup -g 10001 nepos && adduser -D -H -u 10001 -G nepos nepos
COPY --from=build /build/dist /app/public
COPY server/signaling.php /app/signaling.php
COPY container /etc/nepos
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/bin/supervisord", "-n", "-c", "/etc/nepos/supervisord.conf"]
