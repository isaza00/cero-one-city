// Auth store: tokens + user, persisted to localStorage.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../api/types";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setTokens: (access: string, refresh: string, user: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (accessToken, refreshToken, user) =>
        set({ accessToken, refreshToken, user }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: "cero-auth" },
  ),
);

// Refresh tokens are one-use: when another tab rotates them, this tab's copy
// goes stale and its next refresh would fail and log the user out. Follow the
// other tab's writes instead.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "cero-auth") void useAuth.persist.rehydrate();
  });
}
