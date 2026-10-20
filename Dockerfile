# ---------- Build ----------
# Läuft immer auf der Maschine, die baut – ohne Emulation. Das Ergebnis ist
# reines JavaScript und für amd64 und arm64 dasselbe. (Unter Emulation stürzten
# die nativen Build-Werkzeuge für arm64 gelegentlich ab.)
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Abhängigkeiten zur Laufzeit ----------
# Je Zielplattform installiert: libsql bringt die passende Binärdatei mit
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Laufzeit ----------
FROM node:24-alpine
# tzdata: Monatsauswertungen rechnen in österreichischer Zeit
# qpdf und jpegtran (libjpeg-turbo-utils): hochgeladene PDFs und Fotos verlustfrei verkleinern
RUN apk add --no-cache tzdata qpdf libjpeg-turbo-utils && mkdir -p /data && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Europe/Vienna \
    BODY_SIZE_LIMIT=210M
COPY --from=build --chown=node:node /app/build ./build
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Schrift für die PDFs (Liberation Sans, mit Lizenz) – kann auch ć, č, š, ž, đ
COPY --from=build --chown=node:node /app/fonts ./fonts
COPY --from=build --chown=node:node /app/package.json ./
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "build"]
