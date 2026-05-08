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
    mozjpeg \
    && ln -sf /usr/bin/cjpeg /usr/local/bin/cjpeg-mozjpeg || true

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY worker.js ./
COPY compress.sh ./
RUN chmod +x compress.sh

RUN mkdir -p /tmp/compress

ENV PORT=3001
EXPOSE 3001

CMD ["node", "worker.js"]
