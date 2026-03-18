"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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

const FLOW_LABELS: Record<TransactionFlowType, string> = {
  onramp: "Add funds",
  offramp: "Cash out",
  paybill: "PayBill",
  buygoods: "Till",
};

const POLLABLE_STATUSES = new Set<TransactionStatus>([
  "mpesa_submitted",
  "mpesa_processing",
  "awaiting_onchain_funding",
]);

const TERMINAL_STATUSES = new Set<TransactionStatus>(["succeeded", "failed", "refunded"]);

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
      subtitle: "Generate a PayBill or Till quote, then simulate initiation and polling on top of the transaction engine.",
    };
  }
  return {
    eyebrow: "Cashout Quote",
    title: "Send",
    subtitle: "Create a cashout quote, submit the M-Pesa initiation with your PIN, and poll the transaction into a receipt state.",
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
  const [submitting, setSubmitting] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initiationError, setInitiationError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);

  const copy = useMemo(() => titleForVariant(variant), [variant]);
  const profileStatus = session?.userProfile?.profileStatus || null;
  const needsSetup = profileStatus && profileStatus !== "active";
  const numericAmount = Number(amount);
  const normalizedPin = pin.replace(/\D/g, "").slice(0, 6);

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
  }, [result?.transaction.transactionId, result?.transaction.status, result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInitiationError(null);

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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create quote.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInitiate() {
    if (!result) return;

    setInitiating(true);
    setInitiationError(null);

    try {
      const response = await fetch(getInitiationPath(result.transaction.flowType), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionId: result.transaction.transactionId,
          pin: normalizedPin,
        }),
      });

      const payload = (await response.json()) as TransactionEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to initiate M-Pesa request.");
      }

      setResult((current) => (current ? updateQuoteResult(current, payload.data as TransactionIntent) : current));
      setPin("");
    } catch (nextError) {
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
                  This flow now creates a backend quote and transaction intent. For outbound M-Pesa flows it also supports simulated initiation and receipt polling.
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
                    This is now a live transaction intent backed by the Dotpaymini API. Outbound M-Pesa routes can move it from `quoted` into processing and receipt states.
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
              </ul>

              {canInitiateMpesa(result.transaction.flowType) && result.transaction.status === "quoted" ? (
                <div className="form-stack">
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
                    This uses the PIN you created in Settings and submits the next simulated M-Pesa initiation step.
                  </p>
                  {initiationError ? <p className="error-banner">{initiationError}</p> : null}
                  <div className="cta-row">
                    <button
                      type="button"
                      className="button"
                      disabled={initiating || needsSetup || normalizedPin.length !== 6}
                      onClick={handleInitiate}
                    >
                      {initiating ? "Submitting..." : `Submit ${FLOW_LABELS[result.transaction.flowType]} request`}
                    </button>
                  </div>
                </div>
              ) : null}

              {result.transaction.flowType === "onramp" ? (
                <div className="mini-card">
                  <strong>Onramp note</strong>
                  <span>The add-funds quote is live, but STK initiation is still the next backend slice after outbound M-Pesa submission.</span>
                </div>
              ) : null}

              {POLLABLE_STATUSES.has(result.transaction.status) ? (
                <div className="mini-card">
                  <strong>{polling ? "Polling receipt state" : "Processing request"}</strong>
                  <span>The simulated callback will move this transaction into a final receipt state automatically.</span>
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
