// Owner: C. iPhone photos arrive over iMessage as HEIC (#26); vision models only take PNG/JPEG/WebP/GIF.
// Decode → downscale to the same 1568px cap the extension uses → JPEG. The WASM decoder loads only when a HEIC arrives.
import jpeg from "jpeg-js";

const MAX_EDGE = 1568;
const QUALITY = 85;

type Decoded = { width: number; height: number; data: Uint8ClampedArray };

// ISO-BMFF "ftyp" box at byte 4, major brand at 8–11 (same brands heic-decode accepts).
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
export function isHeic(img: Uint8Array): boolean {
  if (img.length < 12) return false;
  const ascii = (a: number, b: number) => String.fromCharCode(...img.subarray(a, b));
  return ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12));
}

export async function heicToJpeg(img: Uint8Array): Promise<Uint8Array> {
  const { default: decode } = await import("heic-decode");
  const { width, height, data } = await decode({ buffer: img });
  const out = downscale({ width, height, data }, MAX_EDGE);
  return new Uint8Array(jpeg.encode({ width: out.width, height: out.height, data: Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength) }, QUALITY).data);
}

/** Box-filter downscale by an integer factor so the long edge is ≤ max (RGBA). */
function downscale(src: Decoded, max: number): Decoded {
  const f = Math.ceil(Math.max(src.width, src.height) / max);
  if (f <= 1) return src;
  const width = Math.floor(src.width / f);
  const height = Math.floor(src.height / f);
  const data = new Uint8ClampedArray(width * height * 4);
  const n = f * f;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) sum += src.data[((y * f + dy) * src.width + (x * f + dx)) * 4 + c]!;
        data[(y * width + x) * 4 + c] = sum / n;
      }
  return { width, height, data };
}
