import { useState, type ReactNode } from "react";
import { ApiError, api } from "../api/client.js";
import { AuthCard, TextField } from "../components/AuthCard.js";
import { OtpInput } from "../components/OtpInput.js";

const OTP_LENGTH = 6;

export function RivianConnect(props: {
  onDone: () => void;
  mockMode: boolean;
  reauth?: boolean;
  email?: string | null;
}) {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [email, setEmail] = useState(props.email ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const verify = (otp: string) => {
    if (busy) return;
    void run(async () => {
      try {
        await api.rivianOtp(otp);
      } catch (err) {
        // Clear the boxes so the next attempt starts fresh.
        setCode("");
        setFailedAttempts((n) => n + 1);
        throw err;
      }
      props.onDone();
    });
  };

  if (step === "otp") {
    return (
      <AuthCard
        title="Check your email"
        subtitle={
          <>
            Enter the 6-digit code Rivian sent to{" "}
            <span className="font-medium text-[var(--text-primary)]">{email}</span>.
          </>
        }
        step={props.reauth ? undefined : { current: 3, total: 3 }}
        error={error}
        busy={busy}
        submitDisabled={code.length < OTP_LENGTH}
        submitLabel="Verify"
        onSubmit={() => verify(code)}
        footer={
          <p className="text-center text-xs text-[var(--text-muted)]">
            Didn't get a code?{" "}
            <button
              type="button"
              onClick={() => {
                setStep("credentials");
                setCode("");
                setError(null);
              }}
              className="font-medium text-[var(--text-secondary)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-primary)]"
            >
              Start over
            </button>
          </p>
        }
      >
        <OtpInput
          // Remount after each failed attempt so the shake replays.
          key={failedAttempts}
          value={code}
          onChange={(next) => {
            setCode(next);
            if (error) setError(null);
          }}
          onComplete={verify}
          length={OTP_LENGTH}
          invalid={!!error && code.length === 0}
          disabled={busy}
          autoFocus
        />
        {props.mockMode && <MockNotice>Mock mode is on — the code is 000000.</MockNotice>}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={props.reauth ? "Reconnect your Rivian account" : "Connect your Rivian account"}
      subtitle={
        props.reauth
          ? "Your Rivian session expired — sign in again to resume tracking."
          : "Your credentials go directly to Rivian; only the resulting tokens are stored, encrypted."
      }
      step={props.reauth ? undefined : { current: 2, total: 3 }}
      error={error}
      busy={busy}
      submitLabel="Connect"
      onSubmit={() =>
        run(async () => {
          const result = await api.rivianConnect(email.trim(), password);
          if (result.otpRequired) setStep("otp");
          else props.onDone();
        })
      }
    >
      <TextField
        label="Rivian account email"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        inputMode="email"
        autoFocus
      />
      <TextField
        label="Rivian password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      {props.mockMode && (
        <MockNotice>Mock mode is on — any credentials work; OTP is 000000.</MockNotice>
      )}
    </AuthCard>
  );
}

function MockNotice(props: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--status-warning)]">
      {props.children}
    </p>
  );
}
