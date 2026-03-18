"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import type { ProductSession } from "@/lib/product";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const PIN_LENGTH = 6;

type SessionEnvelope = {
  success: boolean;
  message?: string;
  data?: ProductSession;
};

function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function normalizePin(value: string) {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

function statusSummary(status: "needs_profile" | "needs_pin" | "active") {
  if (status === "needs_pin") return "Set your payment approval PIN first.";
  if (status === "needs_profile") return "Choose your DotPay confirmation name to finish setup.";
  return "Your profile is ready for the next product flows.";
}

export function SettingsScreen({ session }: { session: ProductSession | null }) {
  const [activeSession, setActiveSession] = useState<ProductSession | null>(session);
  const [username, setUsername] = useState(session?.userProfile?.username || "");
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [identityBusy, setIdentityBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const profile = activeSession?.userProfile || null;
  const normalizedUsername = useMemo(() => normalizeUsername(username), [username]);
  const usernameValid = USERNAME_REGEX.test(normalizedUsername);
  const normalizedPin = useMemo(() => normalizePin(pin), [pin]);
  const normalizedConfirmPin = useMemo(() => normalizePin(confirmPin), [confirmPin]);
  const normalizedCurrentPin = useMemo(() => normalizePin(currentPin), [currentPin]);
  const pinsMatch = normalizedPin.length === PIN_LENGTH && normalizedPin === normalizedConfirmPin;

  async function handleIdentitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usernameValid) {
      setIdentityError("Username must be 3-20 chars using lowercase letters, numbers, or underscore.");
      return;
    }

    setIdentityBusy(true);
    setIdentityError(null);
    setIdentityMessage(null);

    try {
      const response = await fetch("/api/profile/identity", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: normalizedUsername }),
      });

      const payload = (await response.json()) as SessionEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to save confirmation name.");
      }

      setActiveSession(payload.data);
      setUsername(payload.data.userProfile?.username || "");
      setIdentityMessage("Confirmation name saved.");
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : "Failed to save confirmation name.");
    } finally {
      setIdentityBusy(false);
    }
  }

  async function handlePinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (normalizedPin.length !== PIN_LENGTH) {
      setPinError(`PIN must be exactly ${PIN_LENGTH} digits.`);
      return;
    }
    if (!pinsMatch) {
      setPinError("PINs do not match.");
      return;
    }
    if (profile?.pinSet && normalizedCurrentPin.length !== PIN_LENGTH) {
      setPinError(`Current PIN must be exactly ${PIN_LENGTH} digits.`);
      return;
    }

    setPinBusy(true);
    setPinError(null);
    setPinMessage(null);

    try {
      const response = await fetch("/api/profile/pin", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pin: normalizedPin,
          oldPin: profile?.pinSet ? normalizedCurrentPin : null,
        }),
      });

      const payload = (await response.json()) as SessionEnvelope;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "Failed to save PIN.");
      }

      setActiveSession(payload.data);
      setCurrentPin("");
      setPin("");
      setConfirmPin("");
      setPinMessage(profile?.pinSet ? "PIN updated." : "PIN created.");
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "Failed to save PIN.");
    } finally {
      setPinBusy(false);
    }
  }

  return (
    <AppShell
      eyebrow="Profile Setup"
      title="Settings"
      subtitle="Complete your DotPaymini setup with a confirmation name and a 6-digit approval PIN."
      session={activeSession}
    >
      {!activeSession || !profile ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Sign in required</h2>
              <p className="panel-copy">Open the home screen and sign in with Wallet Auth before you continue.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="grid two">
              <div className="mini-card">
                <strong>{profile.dotpayId}</strong>
                <span>{statusSummary(profile.profileStatus)}</span>
              </div>
              <div className="mini-card">
                <strong>{profile.username ? `@${profile.username}` : "No confirmation name yet"}</strong>
                <span>{profile.worldUsername ? `World hint: @${profile.worldUsername}` : "No World username hint yet"}</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Confirmation name</h2>
                <p className="panel-copy">
                  This is the DotPay name we show before send and payment actions. It is separate from your World username.
                </p>
              </div>
            </div>

            <form className="form-stack" onSubmit={handleIdentitySubmit}>
              <label className="field-label" htmlFor="confirmation-name">
                Confirmation name
              </label>
              <input
                id="confirmation-name"
                className="text-input"
                value={username}
                onChange={(event) => {
                  setIdentityError(null);
                  setIdentityMessage(null);
                  setUsername(event.target.value);
                }}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="field-helper">Use 3-20 characters: lowercase letters, numbers, and underscore.</p>
              <div className="mini-card">
                <strong>@{normalizedUsername || "yourname"}</strong>
                <span>Preview of the confirmation name shown in DotPaymini.</span>
              </div>
              {identityError ? <p className="error-banner">{identityError}</p> : null}
              {identityMessage ? <p className="success-banner">{identityMessage}</p> : null}
              <div className="cta-row">
                <button type="submit" className="button" disabled={identityBusy || !usernameValid}>
                  {identityBusy ? "Saving..." : "Save confirmation name"}
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Approval PIN</h2>
                <p className="panel-copy">
                  Use this 6-digit PIN to approve the DotPay payment flows we port next, including M-Pesa cashout and merchant payments.
                </p>
              </div>
            </div>

            <form className="form-stack" onSubmit={handlePinSubmit}>
              {profile.pinSet ? (
                <>
                  <label className="field-label" htmlFor="current-pin">
                    Current PIN
                  </label>
                  <input
                    id="current-pin"
                    className="text-input"
                    type="password"
                    inputMode="numeric"
                    value={currentPin}
                    onChange={(event) => {
                      setPinError(null);
                      setPinMessage(null);
                      setCurrentPin(normalizePin(event.target.value));
                    }}
                    placeholder="••••••"
                  />
                </>
              ) : null}

              <label className="field-label" htmlFor="next-pin">
                {profile.pinSet ? "New PIN" : "Create PIN"}
              </label>
              <input
                id="next-pin"
                className="text-input"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => {
                  setPinError(null);
                  setPinMessage(null);
                  setPin(normalizePin(event.target.value));
                }}
                placeholder="••••••"
              />

              <label className="field-label" htmlFor="confirm-pin">
                Confirm PIN
              </label>
              <input
                id="confirm-pin"
                className="text-input"
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(event) => {
                  setPinError(null);
                  setPinMessage(null);
                  setConfirmPin(normalizePin(event.target.value));
                }}
                placeholder="••••••"
              />

              <div className="mini-card">
                <strong>{profile.pinSet ? "PIN update" : "PIN setup"}</strong>
                <span>Do not reuse your M-Pesa PIN. Use a unique 6-digit code for DotPaymini approvals.</span>
              </div>
              {pinError ? <p className="error-banner">{pinError}</p> : null}
              {pinMessage ? <p className="success-banner">{pinMessage}</p> : null}
              <div className="cta-row">
                <button type="submit" className="button" disabled={pinBusy || !pinsMatch}>
                  {pinBusy ? "Saving..." : profile.pinSet ? "Update PIN" : "Create PIN"}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </AppShell>
  );
}
