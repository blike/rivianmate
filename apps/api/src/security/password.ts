import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const algorithm = "pbkdf2-sha256";
const iterations = 210_000;
const keyLength = 32;
const digest = "sha256";

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await pbkdf2Async(password, salt, iterations, keyLength, digest);
  return `${algorithm}$${iterations}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [storedAlgorithm, storedIterations, storedSalt, storedKey] = storedHash.split("$");
  if (storedAlgorithm !== algorithm || !storedIterations || !storedSalt || !storedKey) {
    return false;
  }

  const iterationCount = Number(storedIterations);
  if (!Number.isInteger(iterationCount) || iterationCount <= 0) {
    return false;
  }

  const salt = Buffer.from(storedSalt, "base64url");
  const expectedKey = Buffer.from(storedKey, "base64url");
  const actualKey = await pbkdf2Async(password, salt, iterationCount, expectedKey.length, digest);

  return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
}
