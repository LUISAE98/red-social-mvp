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

const AUTH_TRANSITION_MS = 1100;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authTransitionMode, setAuthTransitionMode] =
    useState<AuthTransitionMode>("checking");

  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authTransitionModeRef = useRef<AuthTransitionMode>("checking");
  authTransitionModeRef.current = authTransitionMode;

  function clearTransitionTimer() {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }

  function scheduleIdle(delay = AUTH_TRANSITION_MS) {
    clearTransitionTimer();

    transitionTimerRef.current = setTimeout(() => {
      setAuthTransitionMode("idle");
      transitionTimerRef.current = null;
    }, delay);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      // When signing out (u=null during "exiting"), don't restart the timer —
      // the one from startAuthTransition already covers the navigation window.
      if (!(u === null && authTransitionModeRef.current === "exiting")) {
        scheduleIdle();
      }
    });

    return () => {
      clearTransitionTimer();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAuthTransition = (mode: "entering" | "exiting") => {
    setAuthTransitionMode(mode);
    scheduleIdle();
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      authTransitionMode,
      startAuthTransition,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, authTransitionMode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}