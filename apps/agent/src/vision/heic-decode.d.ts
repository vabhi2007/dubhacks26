// heic-decode ships no types. Decodes the first image of a HEIC/HEIF buffer to RGBA pixels.
declare module "heic-decode" {
  export default function decode(input: { buffer: Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}
