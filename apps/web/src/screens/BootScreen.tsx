import { Mountain } from "lucide-react";

interface BootScreenProps {
  error?: string;
}

export function BootScreen({ error }: BootScreenProps) {
  return (
    <main className="setupPage">
      <section className="bootPanel">
        <div className="brand setupBrand">
          <div className="brandMark">
            <Mountain size={22} aria-hidden />
          </div>
          <div>
            <strong>RivianMate</strong>
            <span>Starting up</span>
          </div>
        </div>
        {error ? (
          <div className="notice error">{error}</div>
        ) : (
          <div className="notice">Loading RivianMate...</div>
        )}
      </section>
    </main>
  );
}
