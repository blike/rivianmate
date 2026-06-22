import { useState } from "react";
import type { UnitPrefs } from "../types/index.js";

const STORAGE_KEY = "rivianmate_unit_prefs";

function load(): UnitPrefs {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as UnitPrefs;
  } catch {
    // ignore parse errors
  }
  return { distance: "mi", temperature: "f" };
}

function save(prefs: UnitPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export function useUnitPrefs() {
  const [unitPrefs, setUnitPrefs] = useState<UnitPrefs>(load);

  function update(patch: Partial<UnitPrefs>) {
    setUnitPrefs((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }

  return { unitPrefs, update } as const;
}
