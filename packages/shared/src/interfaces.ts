// Swappable integrations — DESIGN.md §8.4. Every impl ships with a mock so no workstream blocks another.
import type { Offer } from "./schemas";

export type BBox = { x: number; y: number; w: number; h: number };

export interface Vision {
  detect(img: Uint8Array): Promise<{
    objects: { label: string; bbox: BBox; conf: number }[];
    ocr: string[];
    caption?: string;
  }>;
}

export type RawOffer = Omit<Offer, "_id" | "productId" | "matched" | "fetchedAt"> & {
  title: string;
  thumbnail?: string;
};

export interface PriceSource {
  search(query: string): Promise<RawOffer[]>;
}

export type OutboundMessage = { text: string; imageUrl?: string; link?: string };
export type InboundMessage = { userId: string; text: string; imageUrls: string[]; channel: "imessage" | "voice" };

export interface Messenger {
  send(userId: string, msg: OutboundMessage): Promise<void>;
  onInbound(handler: (msg: InboundMessage) => Promise<void>): void;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export type PriceSourceMode = "live" | "cache" | "mock";
export type VisionMode = "perceptron" | "claude";
export type MessengerMode = "photon" | "console";
