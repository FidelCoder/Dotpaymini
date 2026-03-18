import type { BackendUserProfile } from "@/lib/product";

type Envelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
};

function getInternalApiKey() {
  const value = String(process.env.DOTPAYMINI_INTERNAL_API_KEY || "").trim();
  if (!value) {
    throw new Error("DOTPAYMINI_INTERNAL_API_KEY is not configured.");
  }
  return value;
}

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "x-dotpaymini-internal-key": getInternalApiKey(),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.message || "Dotpaymini API request failed.");
  }

  return payload.data;
}

export async function syncWalletUserProfile(input: {
  address: string;
  usernameHint?: string | null;
  profilePictureUrl?: string | null;
  walletAuthVersion?: number | null;
}) {
  return apiRequest<BackendUserProfile>("/api/users/session", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getBackendUserProfile(address: string) {
  return apiRequest<BackendUserProfile>(`/api/users/${encodeURIComponent(address)}`);
}

export async function setBackendIdentity(address: string, username: string) {
  return apiRequest<BackendUserProfile>(`/api/users/${encodeURIComponent(address)}/profile`, {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });
}

export async function setBackendPin(address: string, pin: string, oldPin?: string | null) {
  return apiRequest<BackendUserProfile>(`/api/users/${encodeURIComponent(address)}/pin`, {
    method: "PATCH",
    body: JSON.stringify({ pin, oldPin: oldPin || null }),
  });
}
