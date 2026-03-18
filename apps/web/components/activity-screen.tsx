"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { ProductSession, TransactionIntent } from "@/lib/product";

type ActivityEnvelope = {
  success: boolean;
  message?: string;
  data?: {
    transactions: TransactionIntent[];
  };
};

function labelForFlow(flowType: TransactionIntent["flowType"]) {
  if (flowType === "onramp") return "Add funds";
  if (flowType === "offramp") return "Cash out";
  if (flowType === "paybill") return "PayBill";
  return "Till";
}

function amountLabel(transaction: TransactionIntent) {
  if (transaction.quote.currency === "USD") {
    return `$${transaction.quote.amountRequested.toFixed(2)}`;
  }
  return `KSh ${transaction.quote.amountRequested.toFixed(2)}`;
}

export function ActivityScreen({ session }: { session: ProductSession | null }) {
  const [transactions, setTransactions] = useState<TransactionIntent[]>([]);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/transactions?limit=12", { cache: "no-store" });
        const payload = (await response.json()) as ActivityEnvelope;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.message || "Failed to load transactions.");
        }
        if (active) {
          setTransactions(payload.data.transactions);
        }
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load transactions.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [session]);

  return (
    <AppShell
      eyebrow="Transaction Log"
      title="Activity"
      subtitle="Track the quote and transaction intents already created in Dotpaymini while we wire the next settlement steps."
      session={session}
    >
      {!session ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Sign in required</h2>
              <p className="panel-copy">Open the home screen and sign in with Wallet Auth before viewing activity.</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Recent transaction intents</h2>
              <p className="panel-copy">
                These are coming from the backend transaction store, not mock data. Right now you’ll mostly see quotes until initiation routes are added.
              </p>
            </div>
          </div>

          {loading ? <p className="field-helper">Loading activity...</p> : null}
          {error ? <p className="error-banner">{error}</p> : null}

          {!loading && !error && transactions.length === 0 ? (
            <p className="field-helper">No transaction intents yet. Create one from Send, Pay, or Add Funds.</p>
          ) : null}

          {!loading && transactions.length > 0 ? (
            <ul className="list">
              {transactions.map((transaction) => (
                <li key={transaction.transactionId} className="list-item">
                  <div>
                    <strong>{labelForFlow(transaction.flowType)}</strong>
                    <span>
                      {amountLabel(transaction)} • {transaction.transactionId}
                    </span>
                  </div>
                  <span className="pill live">{transaction.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </AppShell>
  );
}
