import { useState } from "react";
import { postJson } from "../api/client.js";
import type { RivianAuthStartResult } from "../types/index.js";

interface RivianCredentialPanelProps {
  onComplete: () => void;
}

export function RivianCredentialPanel({ onComplete }: RivianCredentialPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await postJson<RivianAuthStartResult>("/api/rivian/auth/start", {
        email,
        password,
      });
      if (result.status === "mfa_required" && result.challengeId) {
        setChallengeId(result.challengeId);
        setPassword("");
        setMessage("Enter the one-time code from Rivian.");
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Rivian sign-in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) {
      setError("Start Rivian sign-in again.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await postJson<RivianAuthStartResult>("/api/rivian/auth/mfa", { challengeId, otpCode });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete Rivian MFA.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="credentialBand">
      <div>
        <p className="eyebrow">Rivian Account</p>
        <h2>{challengeId ? "Enter MFA code" : "Connect your Rivian account"}</h2>
        <p>
          RivianMate stores tokens encrypted in local Postgres and uses read-only API access for
          logging.
        </p>
      </div>
      {challengeId ? (
        <form className="inlineForm" onSubmit={handleMfa}>
          <label>
            MFA code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={(e) => setOtpCode(e.target.value)}
              required
              value={otpCode}
            />
          </label>
          <button className="primaryButton" disabled={submitting} type="submit">
            {submitting ? "Verifying..." : "Verify Code"}
          </button>
        </form>
      ) : (
        <form className="inlineForm" onSubmit={handleStart}>
          <label>
            Email
            <input
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="primaryButton" disabled={submitting} type="submit">
            {submitting ? "Connecting..." : "Connect Rivian"}
          </button>
        </form>
      )}
      {message && <div className="notice">{message}</div>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
