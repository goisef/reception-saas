/**
 * PWA アイコンを生成する。
 *
 * デザイン確定前のプレースホルダー。バイナリのアイコンをリポジトリに
 * 手で置くと差し替え履歴が追えなくなるので、生成スクリプトを正とする。
 * デザインが決まったらこのスクリプトを捨てて実ファイルを置く。
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BG = [15, 23, 42]; // slate-900
const FG = [248, 250, 252]; // slate-50

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** 角の丸い四角に、中央へ受付カウンターを模した横棒を描く。 */
function pixel(x, y, size) {
  const radius = size * 0.22;
  const inset = 0;
  const nearestX = Math.min(Math.max(x, inset + radius), size - inset - radius);
  const nearestY = Math.min(Math.max(y, inset + radius), size - inset - radius);
  const dist = Math.hypot(x - nearestX, y - nearestY);
  if (dist > radius) return null; // 角の外は透明

  const barTop = size * 0.56;
  const barBottom = size * 0.66;
  const barLeft = size * 0.24;
  const barRight = size * 0.76;
  if (y >= barTop && y <= barBottom && x >= barLeft && x <= barRight) return FG;

  const headCx = size * 0.5;
  const headCy = size * 0.4;
  const headR = size * 0.12;
  if (Math.hypot(x - headCx, y - headCy) <= headR) return FG;

  return BG;
}

function makePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const color = pixel(x + 0.5, y + 0.5, size);
      if (color === null) {
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
        raw[offset + 3] = 0;
      } else {
        raw[offset] = color[0];
        raw[offset + 1] = color[1];
        raw[offset + 2] = color[2];
        raw[offset + 3] = 255;
      }
      offset += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(process.cwd(), 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`wrote ${file}`);
}
