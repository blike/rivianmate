import type { FormEvent, ReactNode } from "react";

export function AuthCard(props: {
  title: string;
  subtitle?: string;
  error?: string | null;
  busy?: boolean;
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
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">
            Rivian<span className="text-[var(--accent)]">Mate</span>
          </h1>
          <h2 className="mt-2 text-base font-medium">{props.title}</h2>
          {props.subtitle && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {props.subtitle}
            </p>
          )}
        </div>
        {props.children}
        {props.error && (
          <p className="text-sm text-[var(--status-critical)]">{props.error}</p>
        )}
        <button
          type="submit"
          disabled={props.busy}
          className="w-full rounded-md bg-[var(--series-1)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {props.busy ? "Working…" : props.submitLabel}
        </button>
        {props.footer}
      </form>
    </div>
  );
}

export function TextField(props: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--text-secondary)]">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 outline-none focus:border-[var(--series-1)]"
      />
    </label>
  );
}
