import { createDecipheriv, createHash } from "node:crypto";

const algorithm = "aes-256-gcm";
const version = "v1";

export function decryptText(encrypted: string, secret: string) {
  const [storedVersion, iv, tag, ciphertext] = encrypted.split(":");
  if (storedVersion !== version || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted value.");
  }

  const decipher = createDecipheriv(algorithm, keyFromSecret(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}

function keyFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}
