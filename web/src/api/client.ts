// Fetch wrapper with bearer auth and one-shot refresh-token rotation.

import { useAuth } from "../store/auth";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function rawRequest(path: string, options: RequestInit): Promise<Response> {
  const { accessToken } = useAuth.getState();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(path, { ...options, headers });
}

// Single-flight refresh: refresh tokens are one-use (rotated), so two parallel
// 401s must share ONE refresh call - the loser of the race would otherwise
// burn a stale token, fail, and log the user out for no reason.
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const { refreshToken, setTokens } = useAuth.getState();
  if (!refreshToken) return false;
  let r: Response;
  try {
    r = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return false; // network blip: keep the session, the next call retries
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      // Maybe another tab already rotated the token and ours is stale:
      // re-read localStorage and retry once with the newer token.
      await useAuth.persist.rehydrate();
      const fresh = useAuth.getState().refreshToken;
      if (fresh && fresh !== refreshToken) return doRefresh();
      useAuth.getState().logout(); // token truly dead
    }
    return false;
  }
  const data = await r.json();
  setTokens(data.access_token, data.refresh_token, data.user);
  return true;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let r = await rawRequest(path, options);
  if (r.status === 401 && (await tryRefresh())) {
    r = await rawRequest(path, options);
  }
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = body.detail ?? body.error ?? {};
    throw new ApiError(r.status, detail.code ?? "error",
      detail.message ?? `request failed (${r.status})`);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
