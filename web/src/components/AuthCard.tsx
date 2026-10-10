import { useState, type FormEvent, type ReactNode } from "react";

export function AuthCard(props: {
  title: string;
  subtitle?: ReactNode;
  /** Onboarding progress, e.g. { current: 1, total: 3 }. */
  step?: { current: number; total: number };
  error?: string | null;
  busy?: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  onSubmit: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <div className="auth-backdrop flex min-h-full items-center justify-center px-4 py-10">
      <div className="auth-enter w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img
            src="/icon.svg"
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 rounded-2xl shadow-[0_8px_32px_-8px_rgba(245,197,24,0.35)]"
          />
          <span className="text-xl font-semibold tracking-tight">
            Rivian<span className="text-[var(--accent)]">Mate</span>
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="card space-y-5 p-7 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.7)]"
        >
          <div>
            {props.step && <StepDots {...props.step} />}
            <h1 className="text-xl font-semibold tracking-tight">{props.title}</h1>
            {props.subtitle && (
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                {props.subtitle}
              </p>
            )}
          </div>

          <div className="space-y-4">{props.children}</div>

          {props.error && (
            <p
              role="alert"
              className="rounded-lg border border-[color-mix(in_srgb,var(--status-critical)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-critical)_12%,transparent)] px-3 py-2 text-sm text-[#f08a8a]"
            >
              {props.error}
            </p>
          )}

          <button
            type="submit"
            disabled={props.busy || props.submitDisabled}
            aria-busy={props.busy || undefined}
            className="btn-primary h-11 w-full rounded-lg aria-busy:cursor-wait"
          >
            {props.busy && <Spinner />}
            {props.busy ? "Working…" : props.submitLabel}
          </button>
          {props.footer}
        </form>
      </div>
    </div>
  );
}

function StepDots(props: { current: number; total: number }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: props.total }, (_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all ${
              i + 1 === props.current
                ? "w-5 bg-[var(--accent)]"
                : i + 1 < props.current
                  ? "w-2 bg-[var(--text-muted)]"
                  : "w-2 bg-[var(--border)]"
            }`}
          />
        ))}
      </div>
      Step {props.current} of {props.total}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

export function TextField(props: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "email";
  hint?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = props.type === "password";
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-[var(--text-secondary)]">{props.label}</span>
      <span className="relative block">
        <input
          type={isPassword && revealed ? "text" : (props.type ?? "text")}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          className={`h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] hover:border-[#4a4a45] focus:border-[var(--series-1)] focus:ring-3 focus:ring-[color-mix(in_srgb,var(--series-1)_25%,transparent)] ${
            isPassword ? "pr-16" : ""
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </span>
      {props.hint && (
        <span className="mt-1.5 block text-xs text-[var(--text-muted)]" aria-live="polite">
          {props.hint}
        </span>
      )}
    </label>
  );
}
