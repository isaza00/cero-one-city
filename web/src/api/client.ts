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

async function tryRefresh(): Promise<boolean> {
  const { refreshToken, setTokens, logout } = useAuth.getState();
  if (!refreshToken) return false;
  const r = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!r.ok) {
    logout();
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
