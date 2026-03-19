import type {
  BackendUserProfile,
  QuoteResult,
  RecipientLookupResult,
  TransactionIntent,
  TransactionFlowType,
} from "@/lib/product";

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

export async function lookupBackendRecipient(query: string) {
  const params = new URLSearchParams();
  params.set("q", query);
  return apiRequest<RecipientLookupResult>(`/api/users/lookup?${params.toString()}`);
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

export async function createBackendTransactionQuote(input: {
  userAddress: string;
  flowType: TransactionFlowType;
  amount: number;
  currency?: "KES" | "USD";
  phoneNumber?: string | null;
  paybillNumber?: string | null;
  tillNumber?: string | null;
  accountReference?: string | null;
  businessId?: string | null;
  idempotencyKey?: string | null;
}) {
  return apiRequest<QuoteResult>("/api/transactions/quotes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listBackendTransactions(filters: {
  userAddress: string;
  flowType?: TransactionFlowType;
  status?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set("userAddress", filters.userAddress);
  if (filters.flowType) params.set("flowType", filters.flowType);
  if (filters.status) params.set("status", filters.status);
  if (filters.limit) params.set("limit", String(filters.limit));

  const result = await apiRequest<{ transactions: TransactionIntent[] }>(
    `/api/transactions?${params.toString()}`
  );
  return result.transactions;
}

export async function getBackendTransaction(transactionId: string) {
  return apiRequest<TransactionIntent>(`/api/transactions/${encodeURIComponent(transactionId)}`);
}

async function initiateBackendMpesa(path: string, input: {
  transactionId: string;
  userAddress: string;
  pin?: string;
  idempotencyKey?: string | null;
  quoteId?: string | null;
  signature?: string | null;
  signedAt?: string | null;
  nonce?: string | null;
  onchainTxHash?: string | null;
  chainId?: number | null;
  phoneNumber?: string | null;
  paybillNumber?: string | null;
  tillNumber?: string | null;
  accountReference?: string | null;
  businessId?: string | null;
  requester?: string | null;
}) {
  return apiRequest<TransactionIntent>(path, {
    method: "POST",
    headers: input.idempotencyKey
      ? {
          "Idempotency-Key": input.idempotencyKey,
        }
      : undefined,
    body: JSON.stringify(input),
  });
}

export async function initiateBackendOfframp(input: {
  transactionId: string;
  userAddress: string;
  pin: string;
  idempotencyKey?: string | null;
  quoteId?: string | null;
  signature?: string | null;
  signedAt?: string | null;
  nonce?: string | null;
  onchainTxHash?: string | null;
  chainId?: number | null;
  phoneNumber?: string | null;
  businessId?: string | null;
}) {
  return initiateBackendMpesa("/api/mpesa/offramp/initiate", input);
}

export async function initiateBackendOnrampStk(input: {
  transactionId: string;
  userAddress: string;
  phoneNumber: string;
  idempotencyKey?: string | null;
  quoteId?: string | null;
}) {
  return initiateBackendMpesa("/api/mpesa/onramp/stk/initiate", input);
}

export async function initiateBackendPaybill(input: {
  transactionId: string;
  userAddress: string;
  pin: string;
  idempotencyKey?: string | null;
  quoteId?: string | null;
  signature?: string | null;
  signedAt?: string | null;
  nonce?: string | null;
  onchainTxHash?: string | null;
  chainId?: number | null;
  phoneNumber?: string | null;
  paybillNumber?: string | null;
  accountReference?: string | null;
  businessId?: string | null;
  requester?: string | null;
}) {
  return initiateBackendMpesa("/api/mpesa/merchant/paybill/initiate", input);
}

export async function initiateBackendBuygoods(input: {
  transactionId: string;
  userAddress: string;
  pin: string;
  idempotencyKey?: string | null;
  quoteId?: string | null;
  signature?: string | null;
  signedAt?: string | null;
  nonce?: string | null;
  onchainTxHash?: string | null;
  chainId?: number | null;
  tillNumber?: string | null;
  accountReference?: string | null;
  businessId?: string | null;
  requester?: string | null;
}) {
  return initiateBackendMpesa("/api/mpesa/merchant/buygoods/initiate", input);
}
