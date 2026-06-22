import { useState } from "react";
import { postJson } from "../../api/client.js";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (next.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await postJson("/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      setMessage("Password changed successfully.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="inlineForm" onSubmit={handleSubmit}>
      <label>
        Current password
        <input
          autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)}
          required
          type="password"
          value={current}
        />
      </label>
      <label>
        New password
        <input
          autoComplete="new-password"
          minLength={12}
          onChange={(e) => setNext(e.target.value)}
          required
          type="password"
          value={next}
        />
      </label>
      <label>
        Confirm new password
        <input
          autoComplete="new-password"
          minLength={12}
          onChange={(e) => setConfirm(e.target.value)}
          required
          type="password"
          value={confirm}
        />
      </label>
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <button className="primaryButton" disabled={submitting} type="submit">
        {submitting ? "Changing..." : "Change Password"}
      </button>
    </form>
  );
}
