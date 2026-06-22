import { Mountain } from "lucide-react";
import { useState } from "react";
import { postJson } from "../api/client.js";
import type { AuthSession } from "../types/index.js";

interface LoginScreenProps {
  onComplete: () => void;
}

export function LoginScreen({ onComplete }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await postJson<AuthSession>("/api/auth/login", { username, password });
      if (!session.authenticated) {
        setError("Invalid username or password.");
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to log in.");
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
            <span>Local dashboard</span>
          </div>
        </div>
        <div>
          <h1>Sign in</h1>
        </div>
        <form className="setupForm" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              autoComplete="username"
              maxLength={32}
              onChange={(e) => setUsername(e.target.value)}
              required
              value={username}
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
          {error && <div className="notice error">{error}</div>}
          <button className="primaryButton" disabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </section>
    </main>
  );
}
