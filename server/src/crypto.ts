import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const KEY_LEN = 32;
const IV_LEN = 12;

export class TokenCrypto {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;

  constructor(appSecret: string) {
    this.encKey = scryptSync(appSecret, "rivianmate-token-key", KEY_LEN);
    this.macKey = scryptSync(appSecret, "rivianmate-session-key", KEY_LEN);
  }

  /** AES-256-GCM; output is base64(iv | authTag | ciphertext). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }

  decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + 16);
    const ciphertext = buf.subarray(IV_LEN + 16);
    const decipher = createDecipheriv("aes-256-gcm", this.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }

  /** Stateless session cookie: "<expiryEpochMs>.<hmac>". */
  createSession(ttlMs: number, now = Date.now()): string {
    const expiry = String(now + ttlMs);
    return `${expiry}.${this.sign(expiry)}`;
  }

  verifySession(cookie: string | undefined, now = Date.now()): boolean {
    if (!cookie) return false;
    const dot = cookie.indexOf(".");
    if (dot < 1) return false;
    const expiry = cookie.slice(0, dot);
    const sig = cookie.slice(dot + 1);
    const expected = this.sign(expiry);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    return Number(expiry) > now;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.macKey).update(value).digest("base64url");
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), KEY_LEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
