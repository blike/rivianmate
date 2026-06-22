import { titleCase } from "../../utils/formatters.js";

interface StatusPillProps {
  status: string;
}

export function StatusPill({ status }: StatusPillProps) {
  return (
    <div className={`statusPill ${status}`}>
      {titleCase(status.replaceAll("_", " "))}
    </div>
  );
}
