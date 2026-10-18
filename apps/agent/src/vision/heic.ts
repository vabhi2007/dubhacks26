// Owner: C. iPhone photos arrive over iMessage as HEIC (#26); vision models only take PNG/JPEG/WebP/GIF.
// Decode → downscale to the same 1568px cap the extension uses → JPEG. The WASM decoder loads only when a HEIC arrives.
// Note: decoding and the resample are synchronous — about 0.8–1.5s of blocked event loop per 12MP photo.
import jpeg from "jpeg-js";

const MAX_EDGE = 1568;
const QUALITY = 85;
// Header dimensions are checked before any pixel buffer is allocated: a small file can declare a huge image.
// iPhone panoramas are ~64MP, so this blocks only absurd sizes.
const MAX_PIXELS = 100_000_000;

type Decoded = { width: number; height: number; data: Uint8ClampedArray };

// ISO-BMFF "ftyp" box at byte 4, major brand at 8–11 (same brands heic-decode accepts). mif1/msf1 are generic HEIF
// brands that some AVIF files use too; those fail to decode and get a 400 with a HEIF/AVIF message.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
export function isHeic(img: Uint8Array): boolean {
  if (img.length < 12) return false;
  const ascii = (a: number, b: number) => String.fromCharCode(...img.subarray(a, b));
  return ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12));
}

export async function heicToJpeg(img: Uint8Array): Promise<Uint8Array> {
  const { all } = await import("heic-decode");
  const images = await all({ buffer: img });
  try {
    const first = images[0];
    if (!first) throw new Error("no image inside the file");
    if (first.width * first.height > MAX_PIXELS) throw new Error(`photo too large (${first.width}×${first.height})`);
    const out = downscale(await first.decode(), MAX_EDGE);
    return new Uint8Array(jpeg.encode({ width: out.width, height: out.height, data: Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength) }, QUALITY).data);
  } finally {
    images.dispose();
  }
}

/**
 * Area-average downscale so the long edge is exactly ≤ max (RGBA). A non-integer factor matters: an integer one turns
 * a 1600px photo into 800px and throws away detail OCR needs.
 */
function downscale(src: Decoded, max: number): Decoded {
  const scale = max / Math.max(src.width, src.height);
  if (scale >= 1) return src;
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const fx = src.width / width;
  const fy = src.height / height;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += src.data[(sy * src.width + sx) * 4 + c]!;
        data[(y * width + x) * 4 + c] = sum / n;
      }
    }
  }
  return { width, height, data };
}
