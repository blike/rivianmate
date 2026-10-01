import {
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  unguessablePart,
} from "@server/password-policy.js";

/** Live feedback under a new-password field, using the server's policy. */
export function PasswordHint(props: { password: string }) {
  if (!props.password) {
    return <>At least {PASSWORD_MIN_LENGTH} characters. A few random words works well.</>;
  }
  const problem = passwordProblem(props.password);
  // 1 = rejected, 2 = acceptable, 3 = strong.
  const level = problem ? 1 : [...unguessablePart(props.password)].length >= 16 ? 3 : 2;
  const color =
    level === 1 ? "var(--status-warning)" : level === 2 ? "var(--series-1)" : "var(--status-good)";
  return (
    <span className="flex items-center gap-2">
      <span className="flex shrink-0 gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1 w-5 rounded-full transition-colors"
            style={{ background: i <= level ? color : "var(--border)" }}
          />
        ))}
      </span>
      <span style={{ color }}>{problem ?? (level === 3 ? "Strong password" : "Good password")}</span>
    </span>
  );
}
