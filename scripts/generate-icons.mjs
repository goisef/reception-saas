/**
 * アイコンとスプラッシュを生成する。
 *
 * デザイン確定前のプレースホルダー。バイナリを手で置くと差し替え履歴が
 * 追えなくなるので、生成スクリプトを正とする。デザインが決まったら
 * このスクリプトを捨てて実ファイルを置く。
 *
 * PWA だけでなく Capacitor のネイティブプロジェクト側も同じ絵で揃える。
 * ここを通さないと iOS / Android に Capacitor 既定のロゴが残り、
 * 「受付端末なのに知らないアプリのアイコン」という状態で店舗へ出てしまう。
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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

/**
 * 受付カウンター越しの人を模したマーク。
 *
 * glyph は「絵の一辺」ではなく描画キャンバス上の基準サイズ。
 * スプラッシュのように余白の広い絵でも同じ比率で描けるようにしている。
 */
function drawGlyph(x, y, cx, cy, unit) {
  const barTop = cy + unit * 0.06;
  const barBottom = cy + unit * 0.16;
  const barLeft = cx - unit * 0.26;
  const barRight = cx + unit * 0.26;
  if (y >= barTop && y <= barBottom && x >= barLeft && x <= barRight) return true;

  const headR = unit * 0.12;
  return Math.hypot(x - cx, y - (cy - unit * 0.1)) <= headR;
}

/**
 * shape:
 *   'rounded'  角丸の四角（PWA / Android legacy / ホーム画面）
 *   'circle'   円（Android の round アイコン）
 *   'square'   角丸なし（iOS。マスクは OS 側がかける）
 *   'none'     背景を描かない（Android adaptive icon の foreground）
 *
 * glyphScale は絵の大きさ。adaptive icon の foreground は外周が
 * 削られるので、安全領域に収まるよう小さく描く。
 */
/**
 * PNG エンコーダ。
 *
 * alpha=false のときはカラータイプ2 (RGB) で書く。
 * App Store Connect はアルファチャンネルを持つアプリアイコンを弾くため、
 * 全ピクセル不透明でもチャンネル自体を落とす必要がある。
 */
function encodePng(width, height, sample, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(height * (width * channels + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const color = sample(x + 0.5, y + 0.5);
      if (color === null) {
        // 透明。RGB で書く場合は呼び出し側が null を返さない前提。
        raw[offset] = 0;
        raw[offset + 1] = 0;
        raw[offset + 2] = 0;
        if (alpha) raw[offset + 3] = 0;
      } else {
        raw[offset] = color[0];
        raw[offset + 1] = color[1];
        raw[offset + 2] = color[2];
        if (alpha) raw[offset + 3] = 255;
      }
      offset += channels;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // color type: RGBA / RGB
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

function makePng(size, { shape = 'rounded', glyphScale = 1, opaque = false } = {}) {
  const radius = shape === 'rounded' ? size * 0.22 : 0;
  const unit = size * glyphScale;
  const cx = size / 2;
  const cy = size / 2;

  return encodePng(
    size,
    size,
    (px, py) => {
      let inside;
      if (shape === 'none') {
        inside = false;
      } else if (shape === 'circle') {
        inside = Math.hypot(px - cx, py - cy) <= size / 2;
      } else if (shape === 'rounded') {
        const nx = Math.min(Math.max(px, radius), size - radius);
        const ny = Math.min(Math.max(py, radius), size - radius);
        inside = Math.hypot(px - nx, py - ny) <= radius;
      } else {
        inside = true;
      }

      if (drawGlyph(px, py, cx, cy, unit)) return FG;
      if (inside || opaque) return BG;
      return null;
    },
    { alpha: !opaque }
  );
}

/** 横長・縦長のスプラッシュ。背景一色に中央のマークだけ。透過は不要。 */
function makeSplash(width, height) {
  const unit = Math.min(width, height) * 0.32;
  const cx = width / 2;
  const cy = height / 2;

  return encodePng(
    width,
    height,
    (px, py) => (drawGlyph(px, py, cx, cy, unit) ? FG : BG),
    { alpha: false }
  );
}

const root = process.cwd();
let written = 0;

function write(file, buf) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  written += 1;
  console.log(`wrote ${path.relative(root, file)} (${(buf.length / 1024).toFixed(1)}KB)`);
}

// --- PWA ---------------------------------------------------------------
// 180 は iOS の apple-touch-icon 用。iOS はホーム画面追加時に
// manifest の icons を見ないので、この size を別途用意する必要がある。
for (const size of [180, 192, 512]) {
  write(path.join(root, 'public', 'icons', `icon-${size}.png`), makePng(size));
}

// --- iOS ---------------------------------------------------------------
// App Store は透過を含むアイコンを弾く。opaque で描く。
const iosIcons = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
if (existsSync(iosIcons)) {
  write(path.join(iosIcons, 'AppIcon-512@2x.png'), makePng(1024, { shape: 'square', opaque: true }));

  const iosSplash = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');
  // 3枚とも同じ絵。Capacitor のテンプレートが light / dark / 既定の
  // 3スロットを参照しており、欠けるとビルドが警告を出す。
  const splash = makeSplash(2732, 2732);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    write(path.join(iosSplash, name), splash);
  }
}

// --- Android -----------------------------------------------------------
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
if (existsSync(androidRes)) {
  // 密度ごとの実サイズ。launcher は 48dp、adaptive の foreground は 108dp。
  const densities = [
    ['mdpi', 1],
    ['hdpi', 1.5],
    ['xhdpi', 2],
    ['xxhdpi', 3],
    ['xxxhdpi', 4],
  ];

  for (const [density, scale] of densities) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    write(path.join(dir, 'ic_launcher.png'), makePng(Math.round(48 * scale)));
    write(path.join(dir, 'ic_launcher_round.png'), makePng(Math.round(48 * scale), { shape: 'circle' }));
    // adaptive icon は 108dp のキャンバスのうち、中央 72dp の円しか
    // 表示が保証されない。マークの外接半径がそこへ収まる最大の大きさで描く。
    write(
      path.join(dir, 'ic_launcher_foreground.png'),
      makePng(Math.round(108 * scale), { shape: 'none', glyphScale: 0.92 })
    );
  }

  // 起動時のスプラッシュ。縦横それぞれ用意しないと引き伸ばされる。
  const splashSizes = [
    ['mdpi', 320, 480],
    ['hdpi', 480, 800],
    ['xhdpi', 720, 1280],
    ['xxhdpi', 960, 1600],
    ['xxxhdpi', 1280, 1920],
  ];
  for (const [density, short, long] of splashSizes) {
    write(path.join(androidRes, `drawable-port-${density}`, 'splash.png'), makeSplash(short, long));
    write(path.join(androidRes, `drawable-land-${density}`, 'splash.png'), makeSplash(long, short));
  }
  write(path.join(androidRes, 'drawable', 'splash.png'), makeSplash(480, 320));
}

console.log(`\n${written} files`);
