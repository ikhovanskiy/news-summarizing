FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    BODY_SIZE_LIMIT=2097152 \
    NEWS_DATA_DIR=/data \
    NEWS_COLLECTOR_PATH=/app/collect.py \
    TZ=Europe/Moscow

RUN apk add --no-cache ca-certificates python3 tzdata \
    && mkdir /data \
    && chown node:node /data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force
COPY --from=build /app/build ./build
COPY collect.py channels.json ./

USER node
EXPOSE 3001
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "build"]
