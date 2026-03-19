"use client";

import Link from "next/link";
import { MiniKit } from "@worldcoin/minikit-js";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import type {
  ProductSession,
  QuoteResult,
  TransactionFlowType,
  TransactionIntent,
  TransactionStatus,
} from "@/lib/product";

type QuoteVariant = "send" | "pay" | "add-funds";

type QuoteEnvelope = {
  success: boolean;
  message?: string;
  idempotent?: boolean;
  data?: QuoteResult;
};

type TransactionEnvelope = {
  success: boolean;
  message?: string;
  data?: TransactionIntent;
};

type WorldTransactionStatus = "pending" | "mined" | "failed";

type WorldTransactionEnvelope = {
  success: boolean;
  message?: string;
  data?: {
    transactionId: string;
    transactionHash: string | null;
    transactionStatus: WorldTransactionStatus;
    miniappId: string | null;
    updatedAt: string | null;
    network: string | null;
    fromWalletAddress: string | null;
    toContractAddress: string | null;
    reference: string | null;
    timestamp: string | null;
  };
};

const FLOW_LABELS: Record<TransactionFlowType, string> = {
  onramp: "Add funds",
  offramp: "Cash out",
  paybill: "PayBill",
  buygoods: "Till",
};

const POLLABLE_STATUSES = new Set<TransactionStatus>([
  "mpesa_submitted",
  "mpesa_processing",
]);

const TERMINAL_STATUSES = new Set<TransactionStatus>(["succeeded", "failed", "refunded"]);

const SUBMITTABLE_STATUSES = new Set<TransactionStatus>([
  "quoted",
  "awaiting_user_authorization",
  "awaiting_onchain_funding",
]);

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "to",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
  },
] as const;

function getDefaultFlow(variant: QuoteVariant): TransactionFlowType {
  if (variant === "add-funds") return "onramp";
  if (variant === "pay") return "paybill";
  return "offramp";
}

function titleForVariant(variant: QuoteVariant) {
  if (variant === "add-funds") {
    return {
      eyebrow: "Onramp Quote",
      title: "Add Funds",
      subtitle: "Create the first real onramp quote using the new Dotpaymini transaction engine.",
    };
  }
  if (variant === "pay") {
    return {
      eyebrow: "Merchant Quote",
      title: "Pay",
      subtitle: "Generate a PayBill or Till quote, submit the real Daraja request, and track the callback-driven receipt state.",
    };
  }
  return {
    eyebrow: "Cashout Quote",
    title: "Send",
    subtitle: "Create a cashout quote, fund it from World Wallet, submit the real M-Pesa initiation with your PIN, and track the request until the callback lands.",
  };
}

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function canInitiateMpesa(flowType: TransactionFlowType) {
  return flowType === "offramp" || flowType === "paybill" || flowType === "buygoods";
}

function createIdempotencyKey(flowType: TransactionFlowType) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${flowType}:${crypto.randomUUID()}`;
  }

  return `${flowType}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isHexTransactionHash(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

function statusClass(status: TransactionStatus) {
  if (status === "succeeded") return "pill live";
  if (status === "failed" || status === "refunded") return "pill blocked";
  return "pill building";
}

function getInitiationPath(flowType: TransactionFlowType) {
  if (flowType === "offramp") return "/api/mpesa/offramp/initiate";
  if (flowType === "paybill") return "/api/mpesa/merchant/paybill/initiate";
  return "/api/mpesa/merchant/buygoods/initiate";
}

function updateQuoteResult(current: QuoteResult, transaction: TransactionIntent): QuoteResult {
  return {
    ...current,
    transaction,
    quote: transaction.quote,
  };
}

function getWorldFundingHint(status: WorldTransactionStatus | null) {
  if (status === "mined") {
    return "World Wallet transfer confirmed. Your funding hash is ready for backend verification.";
  }

  if (status === "failed") {
    return "The World Wallet transfer did not confirm. You can retry or use the manual hash fallback.";
  }

  if (status === "pending") {
    return "World Wallet transfer submitted. Waiting for on-chain confirmation.";
  }

  return null;
}

export function QuoteWorkbench({
  session,
  variant,
}: {
  session: ProductSession | null;
  variant: QuoteVariant;
}) {
  const [flowType, setFlowType] = useState<TransactionFlowType>(getDefaultFlow(variant));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"KES" | "USD">("KES");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paybillNumber, setPaybillNumber] = useState("");
  const [tillNumber, setTillNumber] = useState("");
  const [accountReference, setAccountReference] = useState("");
  const [pin, setPin] = useState("");
  const [onchainTxHash, setOnchainTxHash] = useState("");
  const [chainId, setChainId] = useState("");
  const [canUseMiniKit, setCanUseMiniKit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [fundingInWallet, setFundingInWallet] = useState(false);
  const [polling, setPolling] = useState(false);
  const [worldFundingError, setWorldFundingError] = useState<string | null>(null);
  const [worldFundingStatus, setWorldFundingStatus] = useState<WorldTransactionStatus | null>(null);
  const [worldTransactionId, setWorldTransactionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initiationError, setInitiationError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const initiationIdempotencyKeyRef = useRef<string | null>(null);

  const copy = useMemo(() => titleForVariant(variant), [variant]);
  const profileStatus = session?.userProfile?.profileStatus || null;
  const needsSetup = profileStatus && profileStatus !== "active";
  const numericAmount = Number(amount);
  const normalizedPin = pin.replace(/\D/g, "").slice(0, 6);
  const normalizedChainId = chainId.trim() ? Number(chainId) : null;
  const onchainRequired = Boolean(result?.transaction.onchain.required);
  const validFundingHash = !onchainRequired || isHexTransactionHash(onchainTxHash);
  const validChainId = normalizedChainId === null || Number.isFinite(normalizedChainId);
  const canFundWithWorldWallet =
    onchainRequired &&
    canUseMiniKit &&
    Boolean(
      result?.transaction.onchain.tokenAddress &&
        result?.transaction.onchain.treasuryAddress &&
        result?.transaction.onchain.expectedAmountUnits
    );

  useEffect(() => {
    setCanUseMiniKit(MiniKit.isInstalled());
  }, []);

  useEffect(() => {
    if (!result) {
      initiationIdempotencyKeyRef.current = null;
      setChainId("");
      setOnchainTxHash("");
      setWorldTransactionId(null);
      setWorldFundingStatus(null);
      setWorldFundingError(null);
      return;
    }

    initiationIdempotencyKeyRef.current = null;
    setChainId(
      result.transaction.onchain.chainId ? String(result.transaction.onchain.chainId) : ""
    );
    setOnchainTxHash(result.transaction.onchain.txHash || "");
    setWorldTransactionId(null);
    setWorldFundingStatus(result.transaction.onchain.txHash ? "mined" : null);
    setWorldFundingError(null);
  }, [result?.transaction.transactionId]);

  useEffect(() => {
    if (!worldTransactionId) return;
    if (worldFundingStatus && worldFundingStatus !== "pending") return;

    let active = true;

    const run = async () => {
      try {
        const response = await fetch(
          `/api/world/transactions/${encodeURIComponent(worldTransactionId)}`,
          {
            cache: "no-store",
          }
        );
        const payload = (await response.json()) as WorldTransactionEnvelope;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.message || "Failed to confirm the World transaction.");
        }

        if (!active) return;

        setWorldFundingStatus(payload.data.transactionStatus);
        setWorldFundingError(null);

        if (payload.data.transactionStatus === "mined" && payload.data.transactionHash) {
          setOnchainTxHash(payload.data.transactionHash);
          if (!chainId && result?.transaction.onchain.chainId) {
            setChainId(String(result.transaction.onchain.chainId));
          }
          setFundingInWallet(false);
        }

        if (payload.data.transactionStatus === "failed") {
          setFundingInWallet(false);
        }
      } catch (nextError) {
        if (!active) return;
        setWorldFundingError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to confirm the World transaction."
        );
      }
    };

    const interval = window.setInterval(run, 2500);
    run();

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [worldTransactionId, worldFundingStatus, result?.transaction.onchain.chainId, chainId]);

  useEffect(() => {
    if (!result) return;
    if (!POLLABLE_STATUSES.has(result.transaction.status)) return;

    let active = true;
    setPolling(true);

    const run = async () => {
      try {
        const response = await fetch(`/api/transactions/${result.transaction.transactionId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as TransactionEnvelope;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.message || "Failed to refresh transaction.");
        }

        if (active) {
          setResult((current) => (current ? updateQuoteResult(current, payload.data as TransactionIntent) : current));
        }
      } catch (nextError) {
        if (active) {
          setInitiationError(nextError instanceof Error ? nextError.message : "Failed to refresh transaction.");
        }
      }
    };

    const interval = window.setInterval(run, 1500);
    run();

    return () => {
      active = false;
      window.clearInterval(interval);
      setPolling(false);
    };
  }, [result?.transaction.transactionId, result?.transaction.status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInitiationError(null);
    setWorldFundingError(null);

    try {
      const response = await fetch("/api/transactions/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flowType,
          amount: numericAmount,
          currency,
          phoneNumber: phoneNumber || null,
          paybillNumber: paybillNumber || null,
          tillNumber: tillNumber || null,
          accountReference: accountReference || null,
        }),
      });

      const payload = (await response.json()) as QuoteEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to create quote.");
      }

      setResult(payload.data);
      setPin("");
      setInitiationError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create quote.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFundWithWorldWallet() {
    if (!result || !onchainRequired) return;

    setWorldFundingError(null);
    setInitiationError(null);
    setFundingInWallet(true);

    try {
      if (!MiniKit.isInstalled()) {
        throw new Error("Open this flow inside World App to fund it from World Wallet.");
      }

      const tokenAddress = String(result.transaction.onchain.tokenAddress || "").trim();
      const treasuryAddress = String(result.transaction.onchain.treasuryAddress || "").trim();
      const expectedAmountUnits = String(result.transaction.onchain.expectedAmountUnits || "").trim();

      if (!tokenAddress || !treasuryAddress || !expectedAmountUnits) {
        throw new Error("Funding configuration is incomplete for this transaction.");
      }

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: tokenAddress,
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [treasuryAddress, BigInt(expectedAmountUnits)],
          },
        ],
      });

      if (finalPayload.status === "error") {
        throw new Error(finalPayload.error_code || "World Wallet transaction was not submitted.");
      }

      setWorldTransactionId(finalPayload.transaction_id);
      setWorldFundingStatus("pending");
    } catch (nextError) {
      setWorldFundingStatus("failed");
      setWorldFundingError(
        nextError instanceof Error ? nextError.message : "Failed to start the World Wallet transfer."
      );
      setFundingInWallet(false);
    }
  }

  async function handleInitiate() {
    if (!result) return;

    setInitiating(true);
    setInitiationError(null);

    try {
      const idempotencyKey =
        initiationIdempotencyKeyRef.current || createIdempotencyKey(result.transaction.flowType);
      initiationIdempotencyKeyRef.current = idempotencyKey;

      const response = await fetch(getInitiationPath(result.transaction.flowType), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionId: result.transaction.transactionId,
          quoteId: result.quote.quoteId,
          pin: normalizedPin,
          idempotencyKey,
          onchainTxHash: onchainRequired ? onchainTxHash.trim() : null,
          chainId: validChainId ? normalizedChainId : null,
        }),
      });

      const payload = (await response.json()) as TransactionEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to initiate M-Pesa request.");
      }

      setResult((current) => (current ? updateQuoteResult(current, payload.data as TransactionIntent) : current));
      setPin("");
    } catch (nextError) {
      initiationIdempotencyKeyRef.current = null;
      setInitiationError(nextError instanceof Error ? nextError.message : "Failed to initiate M-Pesa request.");
    } finally {
      setInitiating(false);
    }
  }

  return (
    <AppShell eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} session={session}>
      {!session ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Sign in required</h2>
              <p className="panel-copy">Open the home screen and complete Wallet Auth before creating a quote.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          {needsSetup ? (
            <section className="note">
              Setup is not complete yet. You can still preview quote creation, but real settlement flows should use a finished profile.
              <span> </span>
              <Link href="/settings">Finish setup</Link>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Quote builder</h2>
                <p className="panel-copy">
                  This flow creates a backend quote and transaction intent. Outbound M-Pesa flows now submit real Daraja requests after PIN approval and verified USDC funding.
                </p>
              </div>
            </div>

            {variant === "pay" ? (
              <div className="segment-row">
                <button
                  type="button"
                  className={`segment${flowType === "paybill" ? " active" : ""}`}
                  onClick={() => setFlowType("paybill")}
                >
                  PayBill
                </button>
                <button
                  type="button"
                  className={`segment${flowType === "buygoods" ? " active" : ""}`}
                  onClick={() => setFlowType("buygoods")}
                >
                  Till
                </button>
              </div>
            ) : null}

            <form className="form-stack" onSubmit={handleSubmit}>
              <label className="field-label" htmlFor={`${variant}-amount`}>
                Amount
              </label>
              <input
                id={`${variant}-amount`}
                className="text-input"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setError(null);
                  setAmount(event.target.value);
                }}
                placeholder={currency === "KES" ? "1500" : "12.50"}
              />

              <div className="segment-row">
                <button
                  type="button"
                  className={`segment${currency === "KES" ? " active" : ""}`}
                  onClick={() => setCurrency("KES")}
                >
                  KES
                </button>
                <button
                  type="button"
                  className={`segment${currency === "USD" ? " active" : ""}`}
                  onClick={() => setCurrency("USD")}
                >
                  USD
                </button>
              </div>

              {(flowType === "onramp" || flowType === "offramp" || flowType === "paybill") && (
                <>
                  <label className="field-label" htmlFor={`${variant}-phone`}>
                    Phone number
                  </label>
                  <input
                    id={`${variant}-phone`}
                    className="text-input"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="254700000001"
                  />
                </>
              )}

              {flowType === "paybill" && (
                <>
                  <label className="field-label" htmlFor={`${variant}-paybill`}>
                    PayBill number
                  </label>
                  <input
                    id={`${variant}-paybill`}
                    className="text-input"
                    value={paybillNumber}
                    onChange={(event) => setPaybillNumber(event.target.value)}
                    placeholder="600000"
                  />
                </>
              )}

              {flowType === "buygoods" && (
                <>
                  <label className="field-label" htmlFor={`${variant}-till`}>
                    Till number
                  </label>
                  <input
                    id={`${variant}-till`}
                    className="text-input"
                    value={tillNumber}
                    onChange={(event) => setTillNumber(event.target.value)}
                    placeholder="300584"
                  />
                </>
              )}

              {(flowType === "paybill" || flowType === "buygoods") && (
                <>
                  <label className="field-label" htmlFor={`${variant}-reference`}>
                    Account reference
                  </label>
                  <input
                    id={`${variant}-reference`}
                    className="text-input"
                    value={accountReference}
                    onChange={(event) => setAccountReference(event.target.value)}
                    placeholder="INV-100"
                  />
                </>
              )}

              {error ? <p className="error-banner">{error}</p> : null}
              <div className="cta-row">
                <button
                  type="submit"
                  className="button"
                  disabled={submitting || !Number.isFinite(numericAmount) || numericAmount <= 0}
                >
                  {submitting ? "Creating quote..." : `Create ${FLOW_LABELS[flowType]} quote`}
                </button>
              </div>
            </form>
          </section>

          {result ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Transaction state</h2>
                  <p className="panel-copy">
                    This is a live transaction intent backed by the Dotpaymini API. Outbound M-Pesa routes move it from quote to verified funding, Daraja submission, and callback receipt states.
                  </p>
                </div>
                <span className={statusClass(result.transaction.status)}>{result.transaction.status}</span>
              </div>

              <div className="grid two">
                <div className="mini-card">
                  <strong>{result.transaction.transactionId}</strong>
                  <span>Transaction intent ID</span>
                </div>
                <div className="mini-card">
                  <strong>{result.quote.quoteId}</strong>
                  <span>Quote ID</span>
                </div>
                <div className="mini-card">
                  <strong>{formatKes(result.quote.totalDebitKes)}</strong>
                  <span>Total debit</span>
                </div>
                <div className="mini-card">
                  <strong>{formatUsd(result.quote.amountUsd)}</strong>
                  <span>USD side</span>
                </div>
              </div>

              <ul className="list">
                <li className="list-item">
                  <div>
                    <strong>Flow</strong>
                    <span>{FLOW_LABELS[result.transaction.flowType]}</span>
                  </div>
                </li>
                <li className="list-item">
                  <div>
                    <strong>Expires</strong>
                    <span>{new Date(result.quote.expiresAt).toLocaleString()}</span>
                  </div>
                </li>
                <li className="list-item">
                  <div>
                    <strong>Expected receive</strong>
                    <span>{formatKes(result.quote.expectedReceiveKes)}</span>
                  </div>
                </li>
                {result.transaction.daraja.conversationId ? (
                  <li className="list-item">
                    <div>
                      <strong>Conversation ID</strong>
                      <span>{result.transaction.daraja.conversationId}</span>
                    </div>
                  </li>
                ) : null}
                {result.transaction.daraja.receiptNumber ? (
                  <li className="list-item">
                    <div>
                      <strong>M-Pesa receipt</strong>
                      <span>{result.transaction.daraja.receiptNumber}</span>
                    </div>
                  </li>
                ) : null}
                {result.transaction.onchain.treasuryAddress ? (
                  <li className="list-item">
                    <div>
                      <strong>Treasury address</strong>
                      <span>{result.transaction.onchain.treasuryAddress}</span>
                    </div>
                  </li>
                ) : null}
                {result.transaction.onchain.txHash ? (
                  <li className="list-item">
                    <div>
                      <strong>Funding tx hash</strong>
                      <span>{result.transaction.onchain.txHash}</span>
                    </div>
                  </li>
                ) : null}
              </ul>

              {canInitiateMpesa(result.transaction.flowType) &&
              SUBMITTABLE_STATUSES.has(result.transaction.status) ? (
                <div className="form-stack">
                  {result.transaction.onchain.required ? (
                    <>
                      <div className="mini-card">
                        <strong>Fund from World Wallet</strong>
                        <span>
                          Send {formatUsd(result.transaction.onchain.expectedAmountUsd)}{" "}
                          {result.transaction.onchain.tokenSymbol || "USDC"} to the DotPay treasury
                          wallet from this same authenticated wallet. Once it is mined, the funding
                          hash is filled in automatically.
                        </span>
                      </div>
                      <div className="cta-row">
                        <button
                          type="button"
                          className="button"
                          disabled={fundingInWallet || !canFundWithWorldWallet}
                          onClick={handleFundWithWorldWallet}
                        >
                          {fundingInWallet ? "Opening World Wallet..." : "Fund with World Wallet"}
                        </button>
                      </div>
                      {!canUseMiniKit ? (
                        <p className="field-helper">
                          Open this screen inside World App to use the in-app transfer. Browser mode can
                          still use the manual funding hash fallback below.
                        </p>
                      ) : null}
                      {getWorldFundingHint(worldFundingStatus) ? (
                        <div className="mini-card">
                          <strong>World funding status</strong>
                          <span>{getWorldFundingHint(worldFundingStatus)}</span>
                        </div>
                      ) : null}
                      {worldTransactionId ? (
                        <div className="mini-card">
                          <strong>{worldTransactionId}</strong>
                          <span>World transaction ID</span>
                        </div>
                      ) : null}
                      <label className="field-label" htmlFor={`${variant}-funding-hash`}>
                        Funding tx hash
                      </label>
                      <input
                        id={`${variant}-funding-hash`}
                        className="text-input"
                        value={onchainTxHash}
                        onChange={(event) => {
                          setInitiationError(null);
                          setWorldFundingError(null);
                          setOnchainTxHash(event.target.value);
                        }}
                        placeholder="0x..."
                      />
                      <label className="field-label" htmlFor={`${variant}-chain-id`}>
                        Chain ID
                      </label>
                      <input
                        id={`${variant}-chain-id`}
                        className="text-input"
                        inputMode="numeric"
                        value={chainId}
                        onChange={(event) => {
                          setInitiationError(null);
                          setChainId(event.target.value.replace(/[^\d]/g, ""));
                        }}
                        placeholder="84532"
                      />
                      <p className="field-helper">
                        If you used the World Wallet button above, the hash is filled in automatically
                        after confirmation. Otherwise, you can still paste a treasury-bound transfer hash
                        manually for backend verification.
                      </p>
                    </>
                  ) : null}
                  <label className="field-label" htmlFor={`${variant}-pin`}>
                    Approval PIN
                  </label>
                  <input
                    id={`${variant}-pin`}
                    className="text-input"
                    type="password"
                    inputMode="numeric"
                    value={normalizedPin}
                    onChange={(event) => {
                      setInitiationError(null);
                      setPin(event.target.value);
                    }}
                    placeholder="••••••"
                  />
                  <p className="field-helper">
                    This uses the PIN you created in Settings and submits the real M-Pesa request to Daraja.
                  </p>
                  {worldFundingError ? <p className="error-banner">{worldFundingError}</p> : null}
                  {result.transaction.onchain.verificationError ? (
                    <p className="error-banner">{result.transaction.onchain.verificationError}</p>
                  ) : null}
                  {initiationError ? <p className="error-banner">{initiationError}</p> : null}
                  <div className="cta-row">
                    <button
                      type="button"
                      className="button"
                      disabled={
                        initiating ||
                        needsSetup ||
                        normalizedPin.length !== 6 ||
                        !validFundingHash ||
                        !validChainId
                      }
                      onClick={handleInitiate}
                    >
                      {initiating ? "Submitting..." : `Submit ${FLOW_LABELS[result.transaction.flowType]} request`}
                    </button>
                  </div>
                </div>
              ) : null}

              {result.transaction.status === "awaiting_onchain_funding" ? (
                <div className="mini-card">
                  <strong>Funding proof required</strong>
                  <span>
                    Dotpaymini has not verified the treasury-bound funding transfer yet. Complete the
                    World Wallet transfer or paste a valid transfer hash, then retry the request.
                  </span>
                </div>
              ) : null}

              {POLLABLE_STATUSES.has(result.transaction.status) ? (
                <div className="mini-card">
                  <strong>{polling ? "Polling latest status" : "Processing request"}</strong>
                  <span>The backend is waiting for the real Daraja callback to move this transaction into its final receipt state.</span>
                </div>
              ) : null}

              {TERMINAL_STATUSES.has(result.transaction.status) ? (
                <div className="mini-card">
                  <strong>{result.transaction.status === "succeeded" ? "Receipt ready" : "Transaction closed"}</strong>
                  <span>
                    {result.transaction.daraja.resultDesc ||
                      result.transaction.daraja.customerMessage ||
                      "The transaction reached a terminal state."}
                  </span>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
