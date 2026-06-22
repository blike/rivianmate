import { Car } from "lucide-react";
import { useState } from "react";
import { postJson } from "../api/client.js";
import type { SetupStatus } from "../types/index.js";

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await postJson<SetupStatus>("/api/setup/admin", { password });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create local admin.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="setupPage">
      <section className="setupPanel">
        <div className="brand setupBrand">
          <div className="brandMark">
            <Car size={22} aria-hidden />
          </div>
          <div>
            <strong>RivianMate</strong>
            <span>First-run setup</span>
          </div>
        </div>
        <div>
          <p className="eyebrow">Local Admin</p>
          <h1>Create your admin password</h1>
          <p className="setupCopy">
            This password protects the local RivianMate dashboard on this machine. Rivian account
            setup comes next.
          </p>
        </div>
        <form className="setupForm" onSubmit={handleSubmit}>
          <label>
            Password
            <input
              autoComplete="new-password"
              minLength={12}
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label>
            Confirm password
            <input
              autoComplete="new-password"
              minLength={12}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          {error && <div className="notice error">{error}</div>}
          <button className="primaryButton" disabled={submitting} type="submit">
            {submitting ? "Creating..." : "Create Admin"}
          </button>
        </form>
      </section>
    </main>
  );
}
