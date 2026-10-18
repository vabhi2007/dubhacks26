// heic-decode ships no types. `all()` reads each image's size from the header before any pixel buffer is allocated.
declare module "heic-decode" {
  type Pixels = { width: number; height: number; data: Uint8ClampedArray };
  type Lazy = { width: number; height: number; decode(): Promise<Pixels> };
  export default function decode(input: { buffer: Uint8Array }): Promise<Pixels>;
  export function all(input: { buffer: Uint8Array }): Promise<Lazy[] & { dispose(): void }>;
}
