#!/usr/bin/env bash
set -euo pipefail

JOB_ID="${1:-unknown}"
INPUT_PATH="${2:-}"
OUTPUT_PATH="${3:-}"
STATUS_FILE="${4:-/dev/null}"
WORK_DIR="${5:-/tmp/compress/${JOB_ID}}"

if [[ -z "$INPUT_PATH" || -z "$OUTPUT_PATH" ]]; then
  echo "usage: compress.sh <job_id> <input_path> <output_path> [status_file] [work_dir]" >&2
  exit 2
fi

mkdir -p "$WORK_DIR"
EXTRACT_DIR="$WORK_DIR/extract"
PROCESSED_DIR="$WORK_DIR/processed"
mkdir -p "$EXTRACT_DIR" "$PROCESSED_DIR"

write_status() {
  local stage="$1"
  local progress="$2"
  local extra="${3:-}"
  printf '{"stage":"%s","progress":%s%s}\n' "$stage" "$progress" "$extra" > "$STATUS_FILE.tmp"
  mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
}

cleanup_intermediates() {
  rm -rf "$WORK_DIR/extract" "$WORK_DIR/processed" "$WORK_DIR/output.7z" "$WORK_DIR/output.tar.zst" 2>/dev/null || true
}
trap cleanup_intermediates EXIT

write_status "extracting" 5

MIME=$(file --brief --mime-type "$INPUT_PATH" 2>/dev/null || echo "application/octet-stream")

case "$MIME" in
  application/zip)
    7z x -y -o"$EXTRACT_DIR" "$INPUT_PATH" >/dev/null
    ;;
  application/x-7z-compressed)
    7z x -y -o"$EXTRACT_DIR" "$INPUT_PATH" >/dev/null
    ;;
  application/x-tar|application/gzip|application/x-gzip)
    tar -xf "$INPUT_PATH" -C "$EXTRACT_DIR"
    ;;
  *)
    cp "$INPUT_PATH" "$EXTRACT_DIR/payload.bin"
    ;;
esac

write_status "analyzing" 15

cd "$EXTRACT_DIR"

TOTAL_FILES=$(find . -type f | wc -l)
PROCESSED_COUNT=0

is_already_compressed() {
  local mime="$1"
  case "$mime" in
    image/jpeg|image/webp|image/gif|image/png) return 0 ;;
    video/mp4|video/x-matroska|video/webm) return 0 ;;
    audio/mpeg|audio/mp4|audio/aac|audio/ogg|audio/opus|audio/webm) return 0 ;;
    application/zip|application/x-7z-compressed|application/x-rar-compressed) return 0 ;;
    application/gzip|application/x-xz|application/x-bzip2|application/zstd) return 0 ;;
    *) return 1 ;;
  esac
}

write_status "transcoding" 25

while IFS= read -r -d '' file; do
  rel="${file#./}"
  out="$PROCESSED_DIR/$rel"
  mkdir -p "$(dirname "$out")"

  filemime=$(file --brief --mime-type "$file" 2>/dev/null || echo "application/octet-stream")

  case "$filemime" in
    video/*)
      tmp_out="${out%.*}.mp4"
      if ffmpeg -y -hide_banner -loglevel error -i "$file" \
          -map_metadata -1 \
          -vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease" \
          -c:v libx265 -preset slow -crf 28 -tag:v hvc1 \
          -c:a aac -b:a 96k \
          "$tmp_out" 2>/dev/null; then
        if [[ -s "$tmp_out" ]] && [[ $(stat -c%s "$tmp_out") -lt $(stat -c%s "$file") ]]; then
          rm -f "$out"
          mv "$tmp_out" "$out"
        else
          rm -f "$tmp_out"
          cp "$file" "$out"
        fi
      else
        rm -f "$tmp_out"
        cp "$file" "$out"
      fi
      ;;
    audio/wav|audio/x-wav|audio/flac|audio/x-flac|audio/aiff|audio/x-aiff)
      tmp_out="${out%.*}.opus"
      if ffmpeg -y -hide_banner -loglevel error -i "$file" \
          -map_metadata -1 \
          -c:a libopus -b:a 64k -vbr on \
          "$tmp_out" 2>/dev/null; then
        rm -f "$out"
        mv "$tmp_out" "$out"
      else
        rm -f "$tmp_out"
        cp "$file" "$out"
      fi
      ;;
    image/png|image/bmp|image/tiff|image/x-tiff)
      tmp_out="${out%.*}.webp"
      if cwebp -quiet -lossless "$file" -o "$tmp_out" 2>/dev/null; then
        if [[ -s "$tmp_out" ]] && [[ $(stat -c%s "$tmp_out") -lt $(stat -c%s "$file") ]]; then
          rm -f "$out"
          mv "$tmp_out" "$out"
        else
          rm -f "$tmp_out"
          cp "$file" "$out"
        fi
      else
        rm -f "$tmp_out"
        cp "$file" "$out"
      fi
      ;;
    application/pdf)
      tmp_out="${out%.*}.pdf"
      if gs -dNOPAUSE -dBATCH -dQUIET -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook \
          -sOutputFile="$tmp_out" "$file" 2>/dev/null; then
        if [[ -s "$tmp_out" ]] && [[ $(stat -c%s "$tmp_out") -lt $(stat -c%s "$file") ]]; then
          rm -f "$out"
          mv "$tmp_out" "$out"
        else
          rm -f "$tmp_out"
          cp "$file" "$out"
        fi
      else
        rm -f "$tmp_out"
        cp "$file" "$out"
      fi
      ;;
    *)
      cp "$file" "$out"
      ;;
  esac

  PROCESSED_COUNT=$((PROCESSED_COUNT + 1))
  if [[ $TOTAL_FILES -gt 0 ]]; then
    PCT=$((25 + (PROCESSED_COUNT * 50 / TOTAL_FILES)))
    write_status "transcoding" "$PCT"
  fi
done < <(find . -type f -print0)

write_status "archiving" 80

ARCHIVE_7Z="$WORK_DIR/output.7z"
ARCHIVE_TZST="$WORK_DIR/output.tar.zst"

cd "$PROCESSED_DIR"

7z a -t7z -m0=lzma2 -mx=9 -mfb=273 -md=64m -ms=on -bd "$ARCHIVE_7Z" . >/dev/null 2>&1 || true

write_status "archiving" 88

tar -cf - . | zstd -19 --long=27 -q -o "$ARCHIVE_TZST" 2>/dev/null || true

write_status "finalizing" 95

SIZE_7Z=999999999999
SIZE_TZST=999999999999
[[ -f "$ARCHIVE_7Z" ]] && SIZE_7Z=$(stat -c%s "$ARCHIVE_7Z")
[[ -f "$ARCHIVE_TZST" ]] && SIZE_TZST=$(stat -c%s "$ARCHIVE_TZST")

if [[ $SIZE_7Z -le $SIZE_TZST && -f "$ARCHIVE_7Z" ]]; then
  cp "$ARCHIVE_7Z" "$OUTPUT_PATH"
  FINAL_SIZE=$SIZE_7Z
elif [[ -f "$ARCHIVE_TZST" ]]; then
  cp "$ARCHIVE_TZST" "$OUTPUT_PATH"
  FINAL_SIZE=$SIZE_TZST
else
  echo "no archive produced" >&2
  exit 3
fi

write_status "done" 100 ",\"compressedSize\":$FINAL_SIZE"

echo "$FINAL_SIZE"
