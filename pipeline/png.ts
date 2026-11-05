// A minimal PNG decoder for 8-bit, non-interlaced RGB or RGBA images (what elevation tiles use), so the
// pipeline needs no image dependency.
import { inflateSync } from "node:zlib";

export interface Image {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Uint8Array; // row by row, `channels` bytes per pixel
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): Image {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0, height = 0, channels: 3 | 4 = 3;
  const idat: Uint8Array[] = [];
  for (let i = 8; i < buf.length; ) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(...buf.subarray(i + 4, i + 8));
    const body = buf.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(i + 8);
      height = view.getUint32(i + 12);
      const depth = body[8], color = body[9], interlace = body[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, colour ${color}, interlace ${interlace}`);
      channels = color === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels]! : 0;
      const b = y > 0 ? pixels[row - stride + x]! : 0;
      const c = x >= channels && y > 0 ? pixels[row - stride + x - channels]! : 0;
      const pred = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      pixels[row + x] = (src[x]! + pred) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}
