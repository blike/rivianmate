import { createHash, randomBytes } from "node:crypto";

export const sessionCookieName = "rivianmate_session";
export const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function sessionExpiresAt() {
  return new Date(Date.now() + sessionDurationMs);
}
