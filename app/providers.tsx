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
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionRegistry } from "@/lib/sessions/useSessionRegistry";
import { showSplash } from "@/lib/splash";

type AuthTransitionMode = "idle" | "checking" | "entering" | "exiting";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  // ¿El usuario autenticado ya tiene doc de perfil? null = aún resolviendo (o
  // sin sesión). Sirve para distinguir "logueado con perfil" de "logueado en
  // onboarding" (Google recién autenticado, sin perfil todavía).
  hasProfile: boolean | null;
  authTransitionMode: AuthTransitionMode;
  startAuthTransition: (mode: "entering" | "exiting") => void;
};

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  hasProfile: null,
  authTransitionMode: "checking",
  startAuthTransition: () => {},
});

const AUTH_TRANSITION_MS = 1100;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
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
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, (u) => {
      // Los usuarios ANÓNIMOS son INVITADOS que compran sin login (donación, súper
      // comentario, tickets…). NO deben cambiar la UI a modo autenticado (shell, sidebar,
      // wallet, nav). Para el contexto de UI valen como no-logueados; su identidad sigue
      // viva en `auth.currentUser` y la usan los pagos de invitado (ver ensureGuestAuth).
      const effective = u && !u.isAnonymous ? u : null;
      setUser(effective);
      setLoading(false);
      // When signing out (u=null during "exiting"), don't restart the timer —
      // the one from startAuthTransition already covers the navigation window.
      if (!(effective === null && authTransitionModeRef.current === "exiting")) {
        scheduleIdle();
      }

      // Resolver si el usuario ya tiene perfil (para el guardián de rutas auth).
      if (!effective) {
        setHasProfile(null);
        return;
      }
      setHasProfile(null); // reset mientras resuelve
      const uid = effective.uid;
      getDoc(doc(db, "users", uid))
        .then((snap) => {
          if (cancelled) return;
          // Solo aplica si sigue siendo el mismo usuario autenticado.
          if (auth.currentUser?.uid === uid) setHasProfile(snap.exists());
        })
        .catch(() => {
          if (!cancelled) setHasProfile(null);
        });
    });

    return () => {
      cancelled = true;
      clearTransitionTimer();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Registro de sesiones activas de este dispositivo (heartbeat + auto-logout
  // remoto). Se activa mientras haya usuario autenticado.
  useSessionRegistry(user);

  const startAuthTransition = (mode: "entering" | "exiting") => {
    // El splash cubre TODA la transición de sesión, entrando y saliendo. Va aquí
    // y no en cada botón porque todos los caminos —el de salir, los cuatro de
    // entrar y las tres redirecciones del guardián— pasan por esta función, y
    // basta que uno se olvide para que se vuelva a asomar el negro.
    //
    // Síncrono, antes del setState: esperar a que React re-renderice deja un
    // frame con la pantalla al aire, y ese frame es justo lo que se veía.
    showSplash();
    setAuthTransitionMode(mode);
    // El cierre de sesión ("exiting") siempre termina en una recarga a /login,
    // que reinicia todo el estado. Le damos un margen amplio al temporizador
    // para que NO reaparezca contenido (parpadeo de la sesión) antes de que la
    // navegación ocurra. "entering" mantiene la transición corta de siempre.
    scheduleIdle(mode === "exiting" ? 6000 : AUTH_TRANSITION_MS);
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      hasProfile,
      authTransitionMode,
      startAuthTransition,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, hasProfile, authTransitionMode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}