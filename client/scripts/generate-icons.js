import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public');

function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  for (const b of buf) {
    crc = (table[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeB = Buffer.from(type);
  const lenB  = Buffer.alloc(4);
  lenB.writeUInt32BE(data.length);
  const crcB  = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([lenB, typeB, data, crcB]);
}

function rawPng(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rows = [];
  const r    = 0x00, g = 0xa8, b = 0x96;
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const row  = new Uint8Array(size * 3 + 1);
    row[0] = 0; // filter
    const cy  = y - half;
    const cy2 = cy * cy;
    let offset = 1;
    for (let x = 0; x < size; x++) {
      const cx  = x - half;
      const r2  = cx * cx + cy2;
      const d   = Math.sqrt(r2);
      if (d <= half - 1) {
        row[offset++] = r; row[offset++] = g; row[offset++] = b;
      } else if (d <= half) {
        row[offset++] = 0; row[offset++] = 0x98; row[offset++] = 0x86;
      } else {
        row[offset++] = 0; row[offset++] = 0; row[offset++] = 0;
      }
    }
    rows.push(Buffer.from(row));
  }

  const raw    = Buffer.concat(rows);
  const idat   = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const size of [192, 512]) {
    const png  = rawPng(size);
    const dest = path.join(OUT, `icon-${size}.png`);
    await new Promise((res, rej) => {
      const ws = createWriteStream(dest);
      ws.on('finish', res);
      ws.on('error', rej);
      ws.end(png);
    });
    console.log(`✓ icon-${size}.png (${Math.round(png.length / 1024)} KB)`);
  }

  console.log('Icons written to', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
