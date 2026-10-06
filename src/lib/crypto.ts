import crypto from "node:crypto";

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "local-dev-key-please-change-in-production-32b";
  // Derive 32-byte key via sha256
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  try {
    if (!payload.startsWith("v1:")) {
      // legacy plain storage — return as-is (migration path)
      return payload;
    }
    const [, ivB64, tagB64, dataB64] = payload.split(":");
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

export function maskSecret(s: string): string {
  if (!s) return "";
  if (s.length <= 8) return "••••••";
  return `${s.slice(0, 3)}••••${s.slice(-2)}`;
}

/** Remove secrets from an object before logging/persisting logs. */
export function redactSecrets<T>(obj: T): T {
  try {
    const json = JSON.stringify(obj);
    const redacted = json.replace(
      /("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2"
    ).replace(/sk-[A-Za-z0-9-_]{8,}/g, "sk-[REDACTED]")
      .replace(/xai-[A-Za-z0-9-_]{8,}/g, "xai-[REDACTED]")
      .replace(/AIza[A-Za-z0-9-_]{8,}/g, "AIza[REDACTED]");
    return JSON.parse(redacted);
  } catch {
    return obj;
  }
}
