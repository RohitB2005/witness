import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PublicUser } from "../shared/domain";
import { api } from "./api";

interface MeResponse {
  user: PublicUser | null;
  bookingCount: number;
}

interface AuthState {
  loading: boolean;
  user: PublicUser | null;
  /** Drives the "My bookings" badge in the nav. */
  bookingCount: number;
  setBookingCount: (count: number) => void;
  setUser: (user: PublicUser) => void;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [bookingCount, setBookingCount] = useState(0);

  const apply = useCallback((me: MeResponse) => {
    setUser(me.user);
    setBookingCount(me.bookingCount);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api<MeResponse>("/api/auth/me"));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user,
      bookingCount,
      setBookingCount,
      setUser,
      refresh,
      login: async (email, password) => {
        apply(
          await api<MeResponse>("/api/auth/login", { method: "POST", body: { email, password } }),
        );
      },
      signup: async (name, email, password) => {
        apply(
          await api<MeResponse>("/api/auth/signup", {
            method: "POST",
            body: { name, email, password },
          }),
        );
      },
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" });
        apply({ user: null, bookingCount: 0 });
      },
    }),
    [loading, user, bookingCount, refresh, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
