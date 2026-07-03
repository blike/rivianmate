import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { AuthCard, TextField } from "../components/AuthCard.js";

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

  if (step === "otp") {
    return (
      <AuthCard
        title="Verification code"
        subtitle={`Rivian sent a one-time code to ${email}.${props.mockMode ? " (Mock mode: use 000000.)" : ""}`}
        error={error}
        busy={busy}
        submitLabel="Verify"
        onSubmit={() =>
          run(async () => {
            await api.rivianOtp(code.trim());
            props.onDone();
          })
        }
      >
        <TextField label="Code" value={code} onChange={setCode} autoFocus />
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
        autoFocus
      />
      <TextField
        label="Rivian password"
        type="password"
        value={password}
        onChange={setPassword}
      />
      {props.mockMode && (
        <p className="text-xs text-[var(--status-warning)]">
          Mock mode is on — any credentials work; OTP is 000000.
        </p>
      )}
    </AuthCard>
  );
}
