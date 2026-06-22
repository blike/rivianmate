import { useState } from "react";
import { postJson } from "../../api/client.js";

interface ChangeUsernameFormProps {
  currentUsername: string;
  onComplete: () => void;
}

export function ChangeUsernameForm({ currentUsername, onComplete }: ChangeUsernameFormProps) {
  const [username, setUsername] = useState(currentUsername);
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      setError("Username may only contain letters, numbers, underscores, and hyphens.");
      return;
    }

    setSubmitting(true);
    try {
      await postJson("/api/auth/change-username", {
        currentPassword,
        newUsername: trimmedUsername,
      });
      setMessage("Username updated successfully.");
      setCurrentPassword("");
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change username.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="inlineForm" onSubmit={handleSubmit}>
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
        Current password
        <input
          autoComplete="current-password"
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </label>
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <button className="primaryButton" disabled={submitting} type="submit">
        {submitting ? "Saving..." : "Update Username"}
      </button>
    </form>
  );
}
