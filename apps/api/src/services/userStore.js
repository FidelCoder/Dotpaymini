const { mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { assertPinFormat, hashPin, verifyPin } = require("./pin");

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const PIN_LENGTH = 6;

function getUserStoreFilePath() {
  if (process.env.USER_STORE_FILE) {
    return path.resolve(process.env.USER_STORE_FILE);
  }

  return path.join(__dirname, "..", "data", "users.json");
}

async function ensureUserStore(filePath = getUserStoreFilePath()) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "[]\n", "utf8");
  }

  return filePath;
}

async function readUsers(filePath = getUserStoreFilePath()) {
  const resolved = await ensureUserStore(filePath);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function writeUsers(users, filePath = getUserStoreFilePath()) {
  const resolved = await ensureUserStore(filePath);
  const tempPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
  await rename(tempPath, resolved);
}

function normalizeAddress(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!ETH_ADDRESS_REGEX.test(normalized)) {
    throw new Error("address must be a valid EVM address.");
  }
  return normalized;
}

function normalizeUsernameHint(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  if (!normalized) return null;
  if (!USERNAME_REGEX.test(normalized)) return null;
  return normalized;
}

function normalizeProductUsername(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  if (!normalized) {
    throw new Error("username is required.");
  }
  if (!USERNAME_REGEX.test(normalized)) {
    throw new Error("username must be 3-20 chars using lowercase letters, numbers, or underscore.");
  }
  return normalized;
}

function normalizeProfilePictureUrl(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function generateDotpayId() {
  return `DP${Math.floor(100000000 + Math.random() * 900000000)}`;
}

async function generateUniqueDotpayId(users) {
  for (let index = 0; index < 12; index += 1) {
    const candidate = generateDotpayId();
    const exists = users.some((user) => user.dotpayId === candidate);
    if (!exists) return candidate;
  }

  return `DP${Date.now().toString().slice(-9)}`;
}

function calculateProfileStatus(user) {
  if (!user.pinHash) return "needs_pin";
  if (!user.username) return "needs_profile";
  return "active";
}

function getProfileCompletedAt(user, now = new Date().toISOString()) {
  if (user.pinHash && user.username) {
    return user.profileCompletedAt || now;
  }
  return null;
}

function toPublicUser(user) {
  return {
    id: user.id,
    address: user.address,
    dotpayId: user.dotpayId,
    authMethod: user.authMethod,
    username: user.username || null,
    worldUsername: user.worldUsername,
    worldUsernameVerified: user.worldUsernameVerified,
    profilePictureUrl: user.profilePictureUrl,
    pinSet: Boolean(user.pinHash),
    pinUpdatedAt: user.pinUpdatedAt || null,
    profileStatus: calculateProfileStatus(user),
    profileCompletedAt: user.profileCompletedAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

async function findUserByAddress(address, options = {}) {
  const filePath = options.filePath || getUserStoreFilePath();
  const users = await readUsers(filePath);
  const normalizedAddress = normalizeAddress(address);
  return users.find((user) => user.address === normalizedAddress) || null;
}

async function upsertSessionUser(input, options = {}) {
  const filePath = options.filePath || getUserStoreFilePath();
  const users = await readUsers(filePath);
  const address = normalizeAddress(input.address);
  const usernameHint = normalizeUsernameHint(input.usernameHint);
  const profilePictureUrl = normalizeProfilePictureUrl(input.profilePictureUrl);
  const walletAuthVersion =
    input.walletAuthVersion === undefined || input.walletAuthVersion === null
      ? null
      : Number(input.walletAuthVersion);
  const now = new Date().toISOString();

  const existingIndex = users.findIndex((user) => user.address === address);
  if (existingIndex === -1) {
    const nextUser = {
      id: crypto.randomUUID(),
      address,
      dotpayId: await generateUniqueDotpayId(users),
      authMethod: "world_wallet",
      username: null,
      worldUsername: usernameHint,
      worldUsernameVerified: false,
      profilePictureUrl,
      pinHash: null,
      pinUpdatedAt: null,
      profileCompletedAt: null,
      walletAuthVersion: Number.isFinite(walletAuthVersion) ? walletAuthVersion : null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    users.push(nextUser);
    await writeUsers(users, filePath);
    return toPublicUser(nextUser);
  }

  const existing = users[existingIndex];
  const nextUser = {
    ...existing,
    authMethod: "world_wallet",
    username: existing.username || null,
    worldUsername: usernameHint || existing.worldUsername || null,
    worldUsernameVerified: existing.worldUsernameVerified || false,
    profilePictureUrl: profilePictureUrl || existing.profilePictureUrl || null,
    pinHash: existing.pinHash || null,
    pinUpdatedAt: existing.pinUpdatedAt || null,
    profileCompletedAt: getProfileCompletedAt(existing, now),
    walletAuthVersion: Number.isFinite(walletAuthVersion) ? walletAuthVersion : existing.walletAuthVersion || null,
    updatedAt: now,
    lastLoginAt: now,
  };

  users[existingIndex] = nextUser;
  await writeUsers(users, filePath);
  return toPublicUser(nextUser);
}

async function setProductIdentity(address, username, options = {}) {
  const filePath = options.filePath || getUserStoreFilePath();
  const users = await readUsers(filePath);
  const normalizedAddress = normalizeAddress(address);
  const normalizedUsername = normalizeProductUsername(username);
  const now = new Date().toISOString();

  const existingIndex = users.findIndex((user) => user.address === normalizedAddress);
  if (existingIndex === -1) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  const usernameOwner = users.find(
    (user) => user.username === normalizedUsername && user.address !== normalizedAddress
  );
  if (usernameOwner) {
    const error = new Error("username is already taken.");
    error.statusCode = 409;
    throw error;
  }

  const nextUser = {
    ...users[existingIndex],
    username: normalizedUsername,
    updatedAt: now,
  };
  nextUser.profileCompletedAt = getProfileCompletedAt(nextUser, now);

  users[existingIndex] = nextUser;
  await writeUsers(users, filePath);
  return toPublicUser(nextUser);
}

async function getPinStatus(address, options = {}) {
  const user = await findUserByAddress(address, options);
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  return {
    address: user.address,
    pinSet: Boolean(user.pinHash),
    pinUpdatedAt: user.pinUpdatedAt || null,
  };
}

async function setUserPin(address, pin, oldPin, options = {}) {
  const filePath = options.filePath || getUserStoreFilePath();
  const users = await readUsers(filePath);
  const normalizedAddress = normalizeAddress(address);
  const now = new Date().toISOString();

  const existingIndex = users.findIndex((user) => user.address === normalizedAddress);
  if (existingIndex === -1) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  const user = users[existingIndex];
  const nextPin = assertPinFormat(pin, PIN_LENGTH);

  if (user.pinHash) {
    if (!oldPin) {
      const error = new Error("oldPin is required to update your PIN.");
      error.statusCode = 400;
      throw error;
    }
    const currentPin = assertPinFormat(oldPin, PIN_LENGTH);
    if (!verifyPin(currentPin, user.pinHash, { length: PIN_LENGTH })) {
      const error = new Error("Invalid PIN.");
      error.statusCode = 401;
      throw error;
    }
  }

  const nextUser = {
    ...user,
    pinHash: hashPin(nextPin, { length: PIN_LENGTH }),
    pinUpdatedAt: now,
    updatedAt: now,
  };
  nextUser.profileCompletedAt = getProfileCompletedAt(nextUser, now);

  users[existingIndex] = nextUser;
  await writeUsers(users, filePath);
  return toPublicUser(nextUser);
}

async function verifyUserPinForAddress(address, pin, options = {}) {
  const user = await findUserByAddress(address, options);
  if (!user || !user.pinHash) {
    const error = new Error("Security PIN is not set. Please set a 6-digit app PIN to continue.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedPin = assertPinFormat(pin, PIN_LENGTH);
  return verifyPin(normalizedPin, user.pinHash, { length: PIN_LENGTH });
}

module.exports = {
  calculateProfileStatus,
  findUserByAddress,
  getPinStatus,
  getUserStoreFilePath,
  normalizeAddress,
  normalizeProductUsername,
  normalizeUsernameHint,
  setProductIdentity,
  setUserPin,
  toPublicUser,
  upsertSessionUser,
  verifyUserPinForAddress,
};
