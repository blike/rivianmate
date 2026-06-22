import { Mountain } from "lucide-react";
import { useState } from "react";
import { postJson } from "../api/client.js";
import type { SetupStatus } from "../types/index.js";

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      setError("Username may only contain letters, numbers, underscores, and hyphens.");
      return;
    }
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
      await postJson<SetupStatus>("/api/setup/admin", {
        username: trimmedUsername,
        password,
      });
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
            <Mountain size={22} aria-hidden />
          </div>
          <div>
            <strong>RivianMate</strong>
            <span>First-run setup</span>
          </div>
        </div>
        <div>
          <p className="eyebrow">Local Admin</p>
          <h1>Create your local account</h1>
          <p className="setupCopy">
            Choose a username and password for this RivianMate dashboard. Rivian account setup
            comes next in Settings.
          </p>
        </div>
        <form className="setupForm" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              autoComplete="username"
              maxLength={32}
              minLength={3}
              onChange={(e) => setUsername(e.target.value)}
              required
              value={username}
            />
          </label>
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
