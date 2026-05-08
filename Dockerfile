FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-deps
WORKDIR /build/server
COPY server/package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
RUN apk add --no-cache \
    bash \
    coreutils \
    findutils \
    file \
    p7zip \
    zstd \
    tar \
    ffmpeg \
    ghostscript \
    libwebp-tools \
    libjpeg-turbo-utils

WORKDIR /app
COPY --from=server-deps /build/server/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/index.js ./index.js
COPY server/src ./src
COPY --from=client-build /build/client/dist ./public
COPY compressor/compress.sh ./tools/compress.sh
RUN chmod +x ./tools/compress.sh && mkdir -p /tmp/compress

ENV NODE_ENV=production
ENV COMPRESSOR_SCRIPT=/app/tools/compress.sh
EXPOSE 3000
CMD ["node", "index.js"]
