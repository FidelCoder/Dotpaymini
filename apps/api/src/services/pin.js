const crypto = require("crypto");

function normalizePin(value) {
  return String(value || "").trim().replace(/\D/g, "");
}

function assertPinFormat(pin, expectedLength) {
  const normalized = normalizePin(pin);
  const len = Number(expectedLength) || 6;

  if (!normalized) {
    throw new Error("pin is required.");
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error("pin must contain digits only.");
  }
  if (normalized.length !== len) {
    throw new Error(`pin must be exactly ${len} digits.`);
  }
  return normalized;
}

function hashPin(pin, options = {}) {
  const normalized = assertPinFormat(pin, options.length || 6);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(normalized, salt, 64, {
    N: 1 << 14,
    r: 8,
    p: 1,
    ...(options.scrypt || {}),
  });

  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function verifyPin(pin, storedHash, options = {}) {
  const normalized = assertPinFormat(pin, options.length || 6);
  const raw = String(storedHash || "").trim();
  const parts = raw.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const derived = crypto.scryptSync(normalized, salt, expected.length, {
    N: 1 << 14,
    r: 8,
    p: 1,
    ...(options.scrypt || {}),
  });

  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

module.exports = {
  assertPinFormat,
  hashPin,
  normalizePin,
  verifyPin,
};
