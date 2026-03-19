"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { flowCards, phaseMilestones, type ProductSession } from "@/lib/product";
import { AppShell } from "@/components/app-shell";

function statusClass(status: "live" | "building" | "blocked") {
  if (status === "live") return "pill live";
  if (status === "blocked") return "pill blocked";
  return "pill building";
}

function profileStatusLabel(status: "needs_profile" | "needs_pin" | "active") {
  if (status === "active") return "ready";
  if (status === "needs_pin") return "needs pin";
  return "needs profile";
}

function nextSetupCopy(status: "needs_profile" | "needs_pin" | "active") {
  if (status === "needs_pin") return "Create your 6-digit approval PIN.";
  if (status === "needs_profile") return "Choose the confirmation name DotPay shows before payments.";
  return "Your setup is complete.";
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function HomeScreen({ session }: { session: ProductSession | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canUseMiniKit, setCanUseMiniKit] = useState(false);

  useEffect(() => {
    setCanUseMiniKit(MiniKit.isInstalled());
  }, []);

  async function handleSignIn() {
    setError(null);
    setBusy(true);

    try {
      if (!MiniKit.isInstalled()) {
        throw new Error("Open this app inside World App to use Wallet Auth.");
      }

      const nonceResponse = await fetch("/api/nonce", { cache: "no-store" });
      const noncePayload = (await nonceResponse.json()) as { nonce?: string; error?: string };

      if (!nonceResponse.ok || !noncePayload.nonce) {
        throw new Error(noncePayload.error || "Failed to create a Wallet Auth nonce.");
      }

      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
        nonce: noncePayload.nonce,
        requestId: "dotpaymini-foundation",
        statement: "Sign in to Dotpaymini and continue your wallet-backed payment session.",
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notBefore: new Date(Date.now() - 60 * 1000),
      });

      if (finalPayload.status === "error") {
        throw new Error(finalPayload.error_code || "Wallet Auth was cancelled.");
      }

      const completeResponse = await fetch("/api/complete-siwe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: finalPayload,
          nonce: noncePayload.nonce,
          user: {
            username: MiniKit.user?.username || null,
            profilePictureUrl: MiniKit.user?.profilePictureUrl || null,
          },
        }),
      });

      const completePayload = (await completeResponse.json()) as {
        isValid?: boolean;
        message?: string;
      };

      if (!completeResponse.ok || !completePayload.isValid) {
        throw new Error(completePayload.message || "Wallet Auth verification failed.");
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Wallet Auth failed.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await fetch("/api/logout", { method: "POST" });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      eyebrow="World Mini App"
      title="Dotpaymini"
      subtitle="Same DotPay product, rebuilt for the World Mini App runtime with Wallet Auth, mobile-first flows, and backend-verified payments."
      session={session}
    >
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Foundation status</h2>
            <p className="panel-copy">
              The repo is now structured as one monorepo. Wallet Auth is wired, docs are in place, and outbound M-Pesa
              flows now run through real Daraja submission plus callback-driven transaction tracking.
            </p>
          </div>
        </div>

        <div className="grid two">
          {flowCards.map((card) => (
            <Link key={card.href} href={card.href} className="mini-card">
              <strong>
                {card.icon} {card.title}
              </strong>
              <span>{card.description}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Wallet Auth</h2>
            <p className="panel-copy">
              World recommends Wallet Auth as the primary auth flow. This foundation uses a server nonce and SIWE
              verification before creating a local session.
            </p>
          </div>
        </div>

        {session ? (
          <div className="stack">
            <div className="grid two">
              <div className="mini-card">
                <strong>
                  {session.userProfile?.username
                    ? `@${session.userProfile.username}`
                    : session.userProfile?.worldUsername
                      ? `@${session.userProfile.worldUsername}`
                      : "Wallet session active"}
                </strong>
                <span>{shortAddress(session.walletAddress)}</span>
              </div>
              <div className="mini-card">
                <strong>{session.userProfile?.dotpayId || "Profile syncing"}</strong>
                <span>
                  {session.userProfile
                    ? `Backend profile ${profileStatusLabel(session.userProfile.profileStatus)}`
                    : "Waiting for backend profile sync."}
                </span>
              </div>
            </div>
            {session.userProfile ? (
              <div className="mini-card">
                <strong>Profile foundation is live</strong>
                <span>
                  Auth method: {session.userProfile.authMethod}. World usernames are treated as hints, while your
                  DotPay confirmation name and PIN now drive onboarding completion.
                </span>
              </div>
            ) : null}
            {session.userProfile && session.userProfile.profileStatus !== "active" ? (
              <div className="mini-card">
                <strong>Complete setup</strong>
                <span>{nextSetupCopy(session.userProfile.profileStatus)}</span>
                <div className="cta-row">
                  <Link href="/settings" className="button">
                    Finish setup
                  </Link>
                </div>
              </div>
            ) : null}
            <div className="cta-row">
              <button type="button" className="button secondary" onClick={handleLogout} disabled={busy}>
                End session
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <div className="mini-card">
              <strong>{canUseMiniKit ? "World App detected" : "Browser mode detected"}</strong>
              <span>
                {canUseMiniKit
                  ? "You can sign in with Wallet Auth from here."
                  : "Wallet Auth only works when this app is opened inside World App."}
              </span>
            </div>
            <div className="cta-row">
              <button type="button" className="button" onClick={handleSignIn} disabled={busy || !canUseMiniKit}>
                {busy ? "Signing in..." : "Sign in with Wallet Auth"}
              </button>
            </div>
          </div>
        )}

        {error ? <p className="note">{error}</p> : null}
      </section>

      <section className="panel">
        <p className="section-title">Milestones</p>
        <ul className="list">
          {phaseMilestones.map((item) => (
            <li key={item.name} className="list-item">
              <div>
                <strong>{item.name}</strong>
                <span>{item.detail}</span>
              </div>
              <span className={statusClass(item.status)}>{item.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="note">
        World Mini App docs currently state that mini app transaction testing is mainnet-only. We can keep the build
        test-safe and mockable, but final in-app payment QA will need World Chain mainnet.
      </section>
    </AppShell>
  );
}
