#!/usr/bin/env bash
# Full, verified eMMC backup of a rooted PF1007L over USB ADB. READ-ONLY on the frame.
#
# Method from wesbos/photo-frame-dashboard (docs/pf1007l-20260113-marker-file-report.md, second unit):
#   - read in 256 MiB chunks with the frame's /sbin/busybox dd (stock dd stops at 2 GiB on January firmware)
#   - each chunk: exact byte count, not all-0xCC filler, and host SHA-256 == a second read hashed on the frame
#   - join, gzip, and read the gzip back to confirm the hash of the whole image
#
# Usage: scripts/backup-frame.sh            (writes backups/<timestamp>/)
set -euo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
BB=/sbin/busybox
CHUNK_MIB=256
cd "$(dirname "$0")/.."

a() { "$ADB" -d "$@"; }
remote() { a shell "$1" | tr -d '\r'; }

[ "$(remote id | cut -d' ' -f1)" = "uid=0(root)" ] || { echo "Need root ADB over USB" >&2; exit 1; }

OUT="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT/chunks"
LOG="$OUT/backup.log"
log() { echo "$(date +%T) $*" | tee -a "$LOG"; }

host_sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
is_cc_filler() { [ "$(LC_ALL=C tr -d '\314' < "$1" | head -c1 | wc -c | tr -d ' ')" = "0" ]; }

# read_range <device> <skip_mib> <count_mib> <expected_bytes> <outfile>
read_range() {
  local dev=$1 skip=$2 count=$3 want=$4 out=$5 try got hsha dsha
  for try in 1 2 3; do
    a exec-out "$BB dd if=$dev bs=1048576 skip=$skip count=$count 2>/dev/null" > "$out"
    got=$(stat -f%z "$out")
    if [ "$got" != "$want" ]; then log "  $out: got $got bytes, want $want (try $try)"; sleep 3; continue; fi
    if is_cc_filler "$out"; then log "  $out: all 0xCC filler (try $try)"; continue; fi
    hsha=$(host_sha "$out")
    dsha=$(remote "$BB dd if=$dev bs=1048576 skip=$skip count=$count 2>/dev/null | $BB sha256sum" | cut -d' ' -f1)
    if [ "$hsha" = "$dsha" ]; then echo "$hsha  $(basename "$out")" >> "$OUT/chunks.sha256"; return 0; fi
    log "  $out: host $hsha != frame $dsha (try $try)"
  done
  log "FAILED: $out after 3 tries"; return 1
}

# --- identity, for the record (no serials) ---
remote 'getprop ro.build.fingerprint; getprop ro.build.display.id; cat /proc/partitions' > "$OUT/device-info.txt"
remote 'for p in /sys/block/mmcblk0/mmcblk0p*; do echo "${p##*/} start=$(cat $p/start) size=$(cat $p/size)"; done' >> "$OUT/device-info.txt"
remote 'ls -l /dev/block/by-name/ 2>/dev/null' >> "$OUT/device-info.txt" || true

SECTORS=$(remote 'cat /sys/block/mmcblk0/size')
TOTAL=$((SECTORS * 512))
TOTAL_MIB=$((TOTAL / 1048576))
log "eMMC: $SECTORS sectors = $TOTAL bytes"
[ $((TOTAL % 1048576)) = 0 ] || { log "eMMC size is not a whole MiB; stopping"; exit 1; }

# --- small partitions first (fast) ---
log "boot0 / boot1 hardware partitions"
for b in mmcblk0boot0 mmcblk0boot1; do
  sz=$(( $(remote "cat /sys/block/$b/size") * 512 ))
  read_range /dev/block/$b 0 $((sz / 1048576)) "$sz" "$OUT/$b.img"
done

log "boot partition (mmcblk0p6)"
read_range /dev/block/mmcblk0p6 0 32 33554432 "$OUT/boot-mmcblk0p6.img"
BOOT_PREFIX=$(head -c $((31028 * 512)) "$OUT/boot-mmcblk0p6.img" | shasum -a 256 | cut -d' ' -f1)
log "boot first 31028 sectors: $BOOT_PREFIX"

# --- whole eMMC ---
N=$(( (TOTAL_MIB + CHUNK_MIB - 1) / CHUNK_MIB ))
log "whole eMMC: $N chunks of $CHUNK_MIB MiB"
for ((i = 0; i < N; i++)); do
  skip=$((i * CHUNK_MIB)); count=$CHUNK_MIB
  [ $((skip + count)) -gt "$TOTAL_MIB" ] && count=$((TOTAL_MIB - skip))
  f=$(printf "%s/chunks/mmcblk0.%03d" "$OUT" "$i")
  read_range /dev/block/mmcblk0 "$skip" "$count" $((count * 1048576)) "$f"
  log "chunk $((i + 1))/$N ok"
done

# --- join, compress, read back ---
log "joining and compressing"
FULL_SHA=$(cat "$OUT"/chunks/mmcblk0.* | shasum -a 256 | cut -d' ' -f1)
cat "$OUT"/chunks/mmcblk0.* | gzip -1 > "$OUT/mmcblk0.img.gz"
READBACK=$(gzip -dc "$OUT/mmcblk0.img.gz" | shasum -a 256 | cut -d' ' -f1)
[ "$FULL_SHA" = "$READBACK" ] || { log "gzip readback mismatch: $FULL_SHA vs $READBACK; chunks kept"; exit 1; }

# the boot region inside the full image must match the separate boot read
# (boot starts at 84 MiB, inside chunk 000; dd avoids a SIGPIPE from `head` under pipefail)
INNER=$(dd if="$OUT/chunks/mmcblk0.000" bs=1048576 skip=84 count=32 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
[ "$INNER" = "$(host_sha "$OUT/boot-mmcblk0p6.img")" ] || { log "boot region mismatch inside full image; chunks kept"; exit 1; }

rm -rf "$OUT/chunks"
{
  echo "mmcblk0.img.gz uncompressed sha256: $FULL_SHA ($TOTAL bytes)"
  echo "boot (mmcblk0p6) first 31028 sectors sha256: $BOOT_PREFIX"
  for f in "$OUT"/*.img; do echo "$(basename "$f") sha256: $(host_sha "$f")"; done
} | tee "$OUT/SHA256SUMS.txt" | tee -a "$LOG"
log "DONE: verified backup in $OUT"
