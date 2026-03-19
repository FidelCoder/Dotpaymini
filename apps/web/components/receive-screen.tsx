"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import type { ProductSession, RecipientLookupResult } from "@/lib/product";

type LookupEnvelope = {
  success: boolean;
  message?: string;
  data?: RecipientLookupResult;
};

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function ReceiveScreen({ session }: { session: ProductSession | null }) {
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<RecipientLookupResult | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const profile = session?.userProfile || null;
  const needsSetup = profile && profile.profileStatus !== "active";
  const receiveFields = [
    {
      label: "DotPay ID",
      value: profile?.dotpayId || null,
      helper: profile?.dotpayId
        ? "Share this for fast user-to-user lookup."
        : "Your DotPay ID appears here after profile sync.",
    },
    {
      label: "Confirmation name",
      value: profile?.username ? `@${profile.username}` : null,
      helper: profile?.username
        ? "This is the public confirmation handle shown before payments."
        : "Set a confirmation name in Settings to make lookup clearer.",
    },
    {
      label: "Wallet address",
      value: session?.walletAddress || null,
      helper: "Use this for direct wallet transfers and settlement proofs.",
    },
  ];

  async function copyValue(label: string, value: string | null) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      window.setTimeout(() => {
        setCopiedLabel((current) => (current === label ? null : current));
      }, 1800);
    } catch {
      setCopiedLabel(null);
    }
  }

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupBusy(true);
    setLookupError(null);
    setLookupResult(null);

    try {
      const response = await fetch(`/api/users/lookup?q=${encodeURIComponent(lookupQuery.trim())}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as LookupEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to lookup recipient.");
      }

      setLookupResult(payload.data);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Failed to lookup recipient.");
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <AppShell
      eyebrow="Receive"
      title="Share your details"
      subtitle="Expose the same key receive identifiers DotPay already relies on: DotPay ID, confirmation name, and wallet address."
      session={session}
    >
      {!session ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Sign in required</h2>
              <p className="panel-copy">Open the home screen and complete Wallet Auth before using the receive surface.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          {needsSetup ? (
            <section className="note">
              Finish setup so your confirmation handle is ready for shareable receive flows.
              <span> </span>
              <Link href="/settings">Open Settings</Link>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Receive identifiers</h2>
                <p className="panel-copy">
                  People can pay you using your DotPay ID, your confirmation handle, or your wallet address depending on the flow they start from.
                </p>
              </div>
            </div>

            <div className="stack">
              {receiveFields.map((field) => (
                <div key={field.label} className="mini-card">
                  <strong>{field.value || "Not ready yet"}</strong>
                  <span>{field.label}</span>
                  <span>{field.helper}</span>
                  <div className="cta-row">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!field.value}
                      onClick={() => copyValue(field.label, field.value)}
                    >
                      {copiedLabel === field.label ? "Copied" : `Copy ${field.label}`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Directory lookup</h2>
                <p className="panel-copy">
                  The mini app can now resolve recipients by wallet address, `DP...` ID, or `@username`. This is the same lookup layer the direct-send flow will build on next.
                </p>
              </div>
            </div>

            <form className="form-stack" onSubmit={handleLookup}>
              <label className="field-label" htmlFor="lookup-query">
                Test an identifier
              </label>
              <input
                id="lookup-query"
                className="text-input"
                value={lookupQuery}
                onChange={(event) => {
                  setLookupError(null);
                  setLookupQuery(event.target.value);
                }}
                placeholder={profile?.dotpayId || "@username or 0xwallet"}
              />
              {lookupError ? <p className="error-banner">{lookupError}</p> : null}
              <div className="cta-row">
                <button type="submit" className="button" disabled={lookupBusy || !lookupQuery.trim()}>
                  {lookupBusy ? "Resolving..." : "Resolve recipient"}
                </button>
              </div>
            </form>

            {lookupResult ? (
              <div className="mini-card">
                <strong>{lookupResult.username ? `@${lookupResult.username}` : shortAddress(lookupResult.address)}</strong>
                <span>{lookupResult.dotpayId || "No DotPay ID exposed"}</span>
                <span>{shortAddress(lookupResult.address)}</span>
              </div>
            ) : null}
          </section>
        </>
      )}
    </AppShell>
  );
}
