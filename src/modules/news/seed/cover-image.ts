import { deflateSync } from 'node:zlib';

/**
 * Generates the seeded news cover (SPEC §10.6 "generated gradient PNG") without image
 * libraries: a diagonal paper-to-marker gradient with soft ruled lines, encoded as RGB PNG.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

type Rgb = [number, number, number];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** `width` x `height` gradient from `from` (top left) to `to` (bottom right). */
export function gradientPng(
  width = 960,
  height = 480,
  from: Rgb = [0xfb, 0xfa, 0xf7],
  to: Rgb = [0xf4, 0xc0, 0x2f],
): Buffer {
  const rowLength = width * 3 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0; // filter: none
    const ruled = y % 48 === 47;
    for (let x = 0; x < width; x++) {
      const t = Math.min(1, Math.max(0, (x / width) * 0.65 + (y / height) * 0.35));
      let [r, g, b] = mix(from, to, t * t);
      if (ruled) [r, g, b] = mix([r, g, b], [0x1d, 0x1b, 0x17], 0.08);
      const offset = y * rowLength + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
