# P2P Share — Aggressive-Compression File Sharing

Full-stack peer-to-peer file sharing with a multi-stage compression pipeline that crushes media-heavy folders before uploading to Cloudflare R2.

## Stack

- **Backend:** Node.js 20 + Express
- **Database:** PostgreSQL 16 (Railway in production)
- **Object storage:** Cloudflare R2 (S3-compatible)
- **Frontend:** React 18 + Vite + TailwindCSS
- **Auth:** JWT access + refresh tokens, bcrypt
- **Compressor:** Alpine container with `ffmpeg`, `7zip`, `zstd`, `ghostscript`, `cwebp`, `mozjpeg`

## Architecture

```
[Browser] --POST stream-->  [Server]  --HTTP stream-->  [Compressor]
                                |                            |
                                |  <---- 7z/zst stream ------+
                                v
                          [Cloudflare R2]
                          (multipart upload)
                                |
                          [PostgreSQL]
                          (metadata only)
```

Live progress flows back to the browser via WebSocket on `/api/upload/:jobId`.

## Compression Pipeline

The compressor walks the uploaded archive, identifies files by magic bytes, and re-encodes:

| Type | Tool | Settings |
|---|---|---|
| Video (mp4, mov, avi, mkv, webm) | ffmpeg | libx265 CRF 28, preset slow, AAC 96k, 1080p max, metadata stripped |
| Lossless audio (wav, flac, aiff) | ffmpeg | Opus 64k VBR |
| Already-compressed audio (mp3, aac) | passthrough | — |
| Images (png, bmp, tiff) | cwebp | lossless WebP |
| PDFs | ghostscript | `/ebook` setting |
| Already-compressed (jpg, mp4 h265, zip…) | passthrough | — |

Then the processed tree is archived two ways and the smaller wins:
1. `7z a -t7z -m0=lzma2 -mx=9 -mfb=273 -md=64m -ms=on`
2. `tar | zstd -19 --long=27`

## Local development

### 1. Install dependencies

```bash
cd server && npm install
cd ../compressor && npm install
cd ../client && npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Generate strong secrets:

```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
```

### 3. Start the stack

```bash
docker compose up --build
```

This starts:
- `postgres` on `:5432`
- `compressor` on `:3001`
- `server` on `:3000` (waits for postgres + compressor health checks)

### 4. Run the frontend

```bash
cd client
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and websocket traffic to `http://localhost:3000`.

## Cloudflare R2 setup

1. Create an R2 bucket in the Cloudflare dashboard.
2. Generate API tokens with **Object Read & Write** scope for that bucket.
3. Fill in:
   - `R2_ACCOUNT_ID` — your Cloudflare account ID
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — token credentials
   - `R2_BUCKET_NAME` — bucket name
   - `R2_ENDPOINT` — `https://<account_id>.r2.cloudflarestorage.com`
4. CORS (only needed if you switch to direct browser-to-R2 uploads):

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://your-app.example.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

By default the server proxies uploads through itself, so CORS on the bucket is not required.

## Railway PostgreSQL setup

1. Create a Railway project and add the **PostgreSQL** plugin.
2. Copy `DATABASE_URL` from Railway's Variables tab into your environment.
3. The server runs `schema.sql` on every startup (idempotent — uses `IF NOT EXISTS`) and then validates that every required column and index is present, exiting with a list of issues if anything is wrong.

## API summary

### Auth
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

### Friends (auth required)
- `GET /api/friends`
- `GET /api/friends/pending`
- `GET /api/friends/search?q=`
- `POST /api/friends/request` — `{ username }`
- `POST /api/friends/accept/:friendshipId`
- `POST /api/friends/reject/:friendshipId`
- `DELETE /api/friends/:userId`

### Files (auth required)
- `POST /api/files/upload` — streamed body, returns `{ jobId }`
- `GET /api/files/jobs/:jobId` — status fallback if WebSocket fails
- `DELETE /api/files/jobs/:jobId` — cancel running job
- `GET /api/files/mine`
- `GET /api/files/shared-with-me`
- `POST /api/files/:fileId/share` — `{ friendUserId }`
- `DELETE /api/files/:fileId/share/:userId`
- `GET /api/files/:fileId/download` — returns `{ url }` (signed, 15 min TTL)
- `DELETE /api/files/:fileId`

### WebSocket
- `ws://host/api/upload/:jobId?token=<accessToken>`

Messages: `{ type: 'snapshot' | 'update', job: { stage, progress, originalSize, compressedSize, ... } }`

## Production deploy notes

- Set `NODE_ENV=production`.
- Put the server behind a reverse proxy (nginx/Caddy) that supports WebSocket upgrades and large request bodies.
- Set body-size and idle-timeout limits high enough to handle long compression jobs (recommend >= 30 minutes).
- Run the compressor on a host with enough CPU and disk; `LZMA2 -mx=9 -md=1g` benefits from many cores.
- Configure log rotation for both server and compressor.
- The frontend builds to `client/dist` — serve via your CDN or behind the same proxy.

## Hard requirements (per spec)

- Streamed uploads end-to-end — no full buffering.
- R2 multipart upload, parallel parts (`queueSize: 4`, `partSize: 16 MB`).
- Signed download URLs expire in 15 minutes.
- Permission validation on every download (owner OR shared-with).
- bcrypt cost factor 12.
- All endpoints behind auth except `/api/auth/*`.
- Real compression stats in the UI.
- WebSocket progress with REST polling fallback.
- Idempotent migrations + startup schema validator that fails loudly.
- No code comments.
