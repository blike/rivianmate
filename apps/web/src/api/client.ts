import type { AuthSession } from "../types/index.js";

export async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch {
    throw new Error("RivianMate API is not reachable. Start the API and Postgres services.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "RivianMate API is not ready. Start the API and Postgres services.");
  }
  return (await response.json()) as T;
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  method: string = "POST"
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method,
    });
  } catch {
    throw new Error("RivianMate API is not reachable. Start the API and Postgres services.");
  }
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "RivianMate API is not ready.");
  return payload as T;
}

export async function logout(): Promise<void> {
  await postJson<AuthSession>("/api/auth/logout", {});
  window.location.reload();
}
