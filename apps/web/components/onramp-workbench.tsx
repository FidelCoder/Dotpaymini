"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import type { ProductSession, QuoteResult, TransactionIntent, TransactionStatus } from "@/lib/product";

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

const POLLABLE_STATUSES = new Set<TransactionStatus>(["mpesa_submitted", "mpesa_processing"]);
const TERMINAL_STATUSES = new Set<TransactionStatus>(["succeeded", "failed", "refunded"]);

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `onramp:${crypto.randomUUID()}`;
  }

  return `onramp:${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function statusClass(status: TransactionStatus) {
  if (status === "succeeded") return "pill live";
  if (status === "failed" || status === "refunded") return "pill blocked";
  return "pill building";
}

export function OnrampWorkbench({ session }: { session: ProductSession | null }) {
  const [amount, setAmount] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const initiationIdempotencyKeyRef = useRef<string | null>(null);

  const numericAmount = Number(amount);
  const profileStatus = session?.userProfile?.profileStatus || null;
  const needsSetup = profileStatus && profileStatus !== "active";

  const copy = useMemo(
    () => ({
      eyebrow: "Onramp",
      title: "Add Funds",
      subtitle: "Create a top-up quote, trigger a real STK push, and wait for wallet settlement after the callback arrives.",
    }),
    []
  );

  useEffect(() => {
    initiationIdempotencyKeyRef.current = null;
  }, [result?.transaction.transactionId]);

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

        const transaction = payload.data as TransactionIntent;

        if (active) {
          setResult((current) =>
            current
              ? {
                  ...current,
                  transaction,
                  quote: transaction.quote,
                }
              : current
          );
        }
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Failed to refresh transaction.");
        }
      }
    };

    const interval = window.setInterval(run, 2000);
    run();

    return () => {
      active = false;
      window.clearInterval(interval);
      setPolling(false);
    };
  }, [result?.transaction.transactionId, result?.transaction.status]);

  async function handleQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/transactions/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flowType: "onramp",
          amount: numericAmount,
          currency: "KES",
          phoneNumber: phoneNumber || null,
        }),
      });

      const payload = (await response.json()) as QuoteEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to create quote.");
      }

      setResult(payload.data);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create quote.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInitiateStk() {
    if (!result) return;

    setInitiating(true);
    setError(null);

    try {
      const idempotencyKey = initiationIdempotencyKeyRef.current || createIdempotencyKey();
      initiationIdempotencyKeyRef.current = idempotencyKey;

      const response = await fetch("/api/mpesa/onramp/stk/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionId: result.transaction.transactionId,
          quoteId: result.quote.quoteId,
          phoneNumber,
          idempotencyKey,
        }),
      });

      const payload = (await response.json()) as TransactionEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to initiate STK push.");
      }

      const transaction = payload.data as TransactionIntent;

      setResult((current) =>
        current
          ? {
              ...current,
              transaction,
              quote: transaction.quote,
            }
          : current
      );
    } catch (nextError) {
      initiationIdempotencyKeyRef.current = null;
      setError(nextError instanceof Error ? nextError.message : "Failed to initiate STK push.");
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
              <p className="panel-copy">Open the home screen and complete Wallet Auth before creating a top-up.</p>
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
                <h2 className="panel-title">Top-up quote</h2>
                <p className="panel-copy">
                  Create a KES quote, trigger a real STK push to the provided phone number, and wait for treasury settlement into the authenticated wallet.
                </p>
              </div>
            </div>

            <form className="form-stack" onSubmit={handleQuote}>
              <label className="field-label" htmlFor="onramp-amount">
                Amount
              </label>
              <input
                id="onramp-amount"
                className="text-input"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setError(null);
                  setAmount(event.target.value);
                }}
                placeholder="1500"
              />

              <label className="field-label" htmlFor="onramp-phone">
                M-Pesa phone number
              </label>
              <input
                id="onramp-phone"
                className="text-input"
                value={phoneNumber}
                onChange={(event) => {
                  setError(null);
                  setPhoneNumber(event.target.value);
                }}
                placeholder="254700000001"
              />

              {error ? <p className="error-banner">{error}</p> : null}
              <div className="cta-row">
                <button
                  type="submit"
                  className="button"
                  disabled={submitting || !Number.isFinite(numericAmount) || numericAmount <= 0 || !phoneNumber.trim()}
                >
                  {submitting ? "Creating quote..." : "Create top-up quote"}
                </button>
              </div>
            </form>
          </section>

          {result ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Top-up state</h2>
                  <p className="panel-copy">
                    The STK request and the later wallet settlement both land on this same backend transaction record.
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
                  <span>USD credit target</span>
                </div>
              </div>

              <ul className="list">
                <li className="list-item">
                  <div>
                    <strong>Phone</strong>
                    <span>{result.transaction.targets.phoneNumber || "-"}</span>
                  </div>
                </li>
                <li className="list-item">
                  <div>
                    <strong>M-Pesa receipt</strong>
                    <span>{result.transaction.daraja.receiptNumber || "-"}</span>
                  </div>
                </li>
                <li className="list-item">
                  <div>
                    <strong>Wallet settlement tx</strong>
                    <span>{result.transaction.onchain.txHash || "-"}</span>
                  </div>
                </li>
              </ul>

              {result.transaction.status === "quoted" ? (
                <div className="cta-row">
                  <button
                    type="button"
                    className="button"
                    disabled={initiating || !phoneNumber.trim()}
                    onClick={handleInitiateStk}
                  >
                    {initiating ? "Submitting..." : "Initiate STK push"}
                  </button>
                </div>
              ) : null}

              {POLLABLE_STATUSES.has(result.transaction.status) ? (
                <div className="mini-card">
                  <strong>{polling ? "Waiting for callback" : "Processing request"}</strong>
                  <span>The backend is waiting for the real STK callback, then it will settle USDC into the authenticated wallet.</span>
                </div>
              ) : null}

              {TERMINAL_STATUSES.has(result.transaction.status) ? (
                <div className="mini-card">
                  <strong>{result.transaction.status === "succeeded" ? "Top-up completed" : "Top-up closed"}</strong>
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
