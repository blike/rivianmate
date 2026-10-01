import { useState } from "react";

/**
 * Segmented one-time-code input. A single transparent <input> sits over the
 * boxes, so typing, paste, backspace and SMS/email autofill all behave like
 * a normal field.
 */
export function OtpInput(props: {
  value: string;
  onChange: (value: string) => void;
  /** Called once every digit is entered. */
  onComplete?: (value: string) => void;
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const length = props.length ?? 6;
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(props.value.length, length - 1);

  const box = (i: number) => {
    const char = props.value[i];
    const active = focused && !props.disabled && i === activeIndex;
    const border = props.invalid
      ? "border-[var(--status-critical)]"
      : active
        ? "border-[var(--accent)] ring-3 ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
        : char
          ? "border-[#4a4a45]"
          : "border-[var(--border)]";
    return (
      <div
        key={i}
        className={`flex h-14 min-w-0 flex-1 items-center justify-center rounded-xl border bg-[var(--surface-0)] text-2xl font-semibold tabular-nums transition ${border}`}
      >
        {char ?? (active ? <span className="otp-caret h-6 w-0.5 rounded-full bg-[var(--accent)]" /> : null)}
      </div>
    );
  };

  return (
    <div className={`relative ${props.invalid ? "otp-shake" : ""} ${props.disabled ? "opacity-60" : ""}`}>
      <input
        value={props.value}
        onChange={(e) => {
          // Accept pasted codes like "123 456" or "123-456".
          const next = e.target.value.replace(/\D/g, "").slice(0, length);
          props.onChange(next);
          if (next.length === length && next !== props.value) props.onComplete?.(next);
        }}
        onFocus={(e) => {
          setFocused(true);
          // Keep the caret at the end so typing always fills the next box.
          const end = e.target.value.length;
          e.target.setSelectionRange(end, end);
        }}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        aria-label="Verification code"
        aria-invalid={props.invalid || undefined}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        spellCheck={false}
        // 16px text stops iOS from zooming in on focus.
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent"
      />
      <div aria-hidden className="flex items-center gap-2">
        {Array.from({ length }, (_, i) => box(i))}
      </div>
    </div>
  );
}
