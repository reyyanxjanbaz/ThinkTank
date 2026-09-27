/**
 * Generates the PWA / home-screen icons in public/ from the brand mark's 24x24
 * pixel grid (MARK_ROWS in src/Logo.tsx), so the icons can never drift from the logo.
 *
 * Every art pixel becomes an exact NxN block (nearest-neighbour, integer scale),
 * so the edges stay crisp at every size. No dependencies: PNGs are encoded with
 * node:zlib.
 *
 *   node scripts/gen-pwa-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BG = "#111338";

const logo = readFileSync(join(root, "src/Logo.tsx"), "utf8");
const palette = Object.fromEntries(
  [...logo.matchAll(/^\s*"?([A-Z0-9])"?:\s*"(#[0-9a-f]{6})"/gim)].map((match) => [match[1], match[2]])
);
const block = logo.match(/const MARK_ROWS: string\[\] = \[([\s\S]*?)\];/);
if (!block) throw new Error("MARK_ROWS not found in src/Logo.tsx");
const rows = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

// Crop to the drawn pixels so the mark is centred on what is actually visible.
const drawn = (x, y) => rows[y][x] !== "." && palette[rows[y][x]];
let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
rows.forEach((row, y) =>
  [...row].forEach((_, x) => {
    if (!drawn(x, y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  })
);
const artW = maxX - minX + 1;
const artH = maxY - minY + 1;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function render(size, scale) {
  const pixels = Buffer.alloc(size * size * 4);
  const [br, bg, bb] = rgb(BG);
  for (let i = 0; i < size * size; i++) pixels.set([br, bg, bb, 255], i * 4);
  const ox = Math.floor((size - artW * scale) / 2);
  const oy = Math.floor((size - artH * scale) / 2);
  for (let y = 0; y < artH; y++) {
    for (let x = 0; x < artW; x++) {
      const key = rows[minY + y][minX + x];
      if (!drawn(minX + x, minY + y)) continue;
      const [r, g, b] = rgb(palette[key]);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          pixels.set([r, g, b, 255], ((oy + y * scale + dy) * size + ox + x * scale + dx) * 4);
        }
      }
    }
  }
  return encodePng(size, size, pixels);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// [file, canvas size, pixel scale]. "any" icons fill ~85% of the canvas; maskable
// ones keep the whole mark inside the 80% safe circle Android crops to.
const ICONS = [
  ["icon-192.png", 192, 7],
  ["icon-512.png", 512, 18],
  ["icon-maskable-192.png", 192, 4],
  ["icon-maskable-512.png", 512, 12],
  ["apple-touch-icon.png", 180, 6]
];

for (const [file, size, scale] of ICONS) {
  writeFileSync(join(root, "public", file), render(size, scale));
  console.log(`public/${file}  ${size}x${size}  (${scale}x)`);
}
