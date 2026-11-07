import type { EncryptedEnvelope, SecureMessage } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return base64ToBytes(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomHex(length: number): string {
  return Array.from(randomBytes(length), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function randomSecret(): string {
  return bytesToBase64Url(randomBytes(32));
}

export function encodeJsonBase64Url(value: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

export function decodeJsonBase64Url<T>(value: string): T {
  return JSON.parse(decoder.decode(base64UrlToBytes(value))) as T;
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(secret);
  if (raw.byteLength !== 32) throw new Error("Invalid pairing secret");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(secret: string, value: unknown): Promise<EncryptedEnvelope> {
  const key = await importAesKey(secret);
  const iv = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );
  return { iv: bytesToBase64Url(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}

export async function decryptJson<T>(secret: string, envelope: EncryptedEnvelope): Promise<T> {
  const key = await importAesKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlToBytes(envelope.iv)) },
    key,
    toArrayBuffer(base64ToBytes(envelope.data)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function encryptMessage<T>(secret: string, payload: T): Promise<EncryptedEnvelope> {
  const message: SecureMessage<T> = {
    timestamp: Date.now(),
    nonce: randomHex(16),
    payload,
  };
  return encryptJson(secret, message);
}

export async function hashBytes(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

