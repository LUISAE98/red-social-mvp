"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

type AuthTransitionMode = "idle" | "checking" | "entering" | "exiting";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  authTransitionMode: AuthTransitionMode;
  startAuthTransition: (mode: "entering" | "exiting") => void;
};

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  authTransitionMode: "checking",
  startAuthTransition: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authTransitionMode, setAuthTransitionMode] =
    useState<AuthTransitionMode>("checking");

  const hasCheckedAuth = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      hasCheckedAuth.current = true;

setTimeout(() => {
  setAuthTransitionMode("idle");
}, 1100);
    });

    return () => unsub();
  }, []);

  const startAuthTransition = (mode: "entering" | "exiting") => {
    setAuthTransitionMode(mode);
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      authTransitionMode,
      startAuthTransition,
    }),
    [user, loading, authTransitionMode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}