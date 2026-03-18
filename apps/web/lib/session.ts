import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import type { BackendUserProfile, ProductSession } from "@/lib/product";

const SESSION_COOKIE = "dotpaymini_session";
const NONCE_COOKIE = "dotpaymini_nonce";
const ONE_WEEK = 60 * 60 * 24 * 7;

function getSessionSecret() {
  return process.env.SESSION_SECRET || "dotpaymini-dev-session-secret";
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function packSession(session: ProductSession) {
  const payload = encodeBase64Url(JSON.stringify(session));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function unpackSession(value: string | undefined | null): ProductSession | null {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(payload)) as ProductSession;
  } catch {
    return null;
  }
}

export function setNonceCookie(nonce: string) {
  cookies().set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60,
    path: "/",
  });
}

export function getNonceCookie() {
  return cookies().get(NONCE_COOKIE)?.value || null;
}

export function clearNonceCookie() {
  cookies().set(NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

export function setSessionCookie(session: ProductSession) {
  cookies().set(SESSION_COOKIE, packSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_WEEK,
    path: "/",
  });
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

export function getSession() {
  return unpackSession(cookies().get(SESSION_COOKIE)?.value);
}

export function updateSessionProfile(
  session: ProductSession,
  userProfile: BackendUserProfile
) {
  const nextSession: ProductSession = {
    ...session,
    username: userProfile.username || userProfile.worldUsername || session.username || null,
    profilePictureUrl: userProfile.profilePictureUrl || session.profilePictureUrl || null,
    userProfile,
  };

  setSessionCookie(nextSession);
  return nextSession;
}
