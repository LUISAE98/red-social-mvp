"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@/i18n/navigation";

import { useIsCompact } from "@/lib/hooks/useMediaQuery";
import { setNavSlideDir } from "@/lib/nav-slide";
import ChatDock, { DOCK_ANIM_MS, DOCK_WIDTH } from "./ChatDock";
import type { ProfileMini } from "./ConversationList";

/**
 * Punto único para abrir un chat, con presentación distinta por plataforma:
 *
 *  - **Laptop**: pestañas ancladas abajo a la derecha (estilo Facebook web).
 *    Se pueden tener VARIAS a la vez, colocadas una al lado de otra; cada una se
 *    despliega y se minimiza por su cuenta. Viven en el layout protegido, así
 *    que sobreviven a los cambios de página.
 *  - **Celular**: página a pantalla completa (`/mensajes/{id}`), con flecha de
 *    regresar. Varias pestañas encima del teclado no funcionan.
 *
 * Quien abre un chat (sidebar, perfil, lista) llama a `openChat` y se
 * desentiende de dónde acaba pintándose.
 */

/** Separación entre pestañas y margen contra el borde derecho. */
const DOCK_GAP = 10;
const DOCK_EDGE = 20;
/**
 * Espacio que se reserva a la izquierda para no tapar el sidebar con pestañas.
 * Es lo que decide cuántas caben.
 */
const DOCK_RESERVED_LEFT = 360;

function computeCapacity(viewportWidth: number): number {
  const usable = viewportWidth - DOCK_RESERVED_LEFT - DOCK_EDGE;
  return Math.max(1, Math.floor((usable + DOCK_GAP) / (DOCK_WIDTH + DOCK_GAP)));
}

type OpenChatArgs = {
  conversationId: string;
  otherUid: string | null;
  profile?: ProfileMini;
};

type DockedChat = OpenChatArgs & {
  minimized: boolean;
  /** true mientras baja deslizando, justo antes de quitarse de la lista. */
  closing: boolean;
  /** Última vez que se abrió o se tocó. Decide a quién se desaloja. */
  lastActiveAt: number;
};

type ChatDockContextValue = {
  openChat: (args: OpenChatArgs) => void;
  /** Hilos abiertos en pestañas, para resaltarlos en las listas. */
  activeConversationIds: string[];
};

const ChatDockContext = createContext<ChatDockContextValue>({
  openChat: () => {},
  activeConversationIds: [],
});

export function useChatDock(): ChatDockContextValue {
  return useContext(ChatDockContext);
}

export default function ChatDockProvider({
  selfUid,
  children,
}: {
  selfUid: string | null;
  children: ReactNode;
}) {
  const isCompact = useIsCompact();
  const router = useRouter();

  /**
   * En orden de apertura: la primera se pinta pegada al borde derecho y las
   * siguientes se van colocando a su izquierda. Abrir una nueva NO mueve a las
   * que ya estaban.
   */
  const [docks, setDocks] = useState<DockedChat[]>([]);

  const [capacity, setCapacity] = useState(() =>
    typeof window === "undefined" ? 1 : computeCapacity(window.innerWidth)
  );

  useEffect(() => {
    const onResize = () => setCapacity(computeCapacity(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const openChat = useCallback(
    (args: OpenChatArgs) => {
      if (isCompact) {
        // Entra deslizando, igual que el resto de la navegación.
        setNavSlideDir("right");
        router.push(`/mensajes/${args.conversationId}`);
        return;
      }

      setDocks((prev) => {
        const now = Date.now();
        const already = prev.some((d) => d.conversationId === args.conversationId);

        // Ya abierta: se despliega, se cancela un cierre en curso y sube su
        // actividad para que no sea la próxima en caer.
        if (already) {
          return prev.map((d) =>
            d.conversationId === args.conversationId
              ? {
                  ...d,
                  closing: false,
                  minimized: false,
                  lastActiveAt: now,
                  profile: args.profile ?? d.profile,
                }
              : d
          );
        }

        // Se AÑADE al final, no al principio: con `row-reverse`, el primero de
        // la lista es el de más a la derecha. Así las que ya estaban se quedan
        // donde están y la nueva aparece a su izquierda, sin recorrer nada.
        const next: DockedChat[] = [
          ...prev,
          { ...args, minimized: false, closing: false, lastActiveAt: now },
        ];

        // Si ya no caben, cae la MENOS reciente (la más vieja sin actividad).
        while (next.length > capacity) {
          let oldest = 0;
          for (let i = 1; i < next.length; i += 1) {
            if (next[i].lastActiveAt < next[oldest].lastActiveAt) oldest = i;
          }
          next.splice(oldest, 1);
        }

        return next;
      });
    },
    [isCompact, router, capacity]
  );

  /**
   * Cerrar en dos tiempos: primero se marca (la pestaña baja deslizando) y al
   * acabar la animación se quita de la lista. Si mientras tanto se vuelve a
   * abrir, `closing` pasa a false y este temporizador ya no la borra.
   */
  const closeDock = useCallback((conversationId: string) => {
    setDocks((prev) =>
      prev.map((d) => (d.conversationId === conversationId ? { ...d, closing: true } : d))
    );
    setTimeout(() => {
      setDocks((prev) =>
        prev.filter((d) => !(d.conversationId === conversationId && d.closing))
      );
    }, DOCK_ANIM_MS);
  }, []);

  const toggleMinimize = useCallback((conversationId: string) => {
    setDocks((prev) =>
      prev.map((d) =>
        d.conversationId === conversationId
          ? { ...d, minimized: !d.minimized, lastActiveAt: Date.now() }
          : d
      )
    );
  }, []);

  // Tras encoger la ventana pueden sobrar. Se ocultan las MENOS recientes (no
  // las primeras de la lista, que están ordenadas por apertura), conservando la
  // posición de las que siguen visibles. No se borran: vuelven a aparecer si la
  // ventana se agranda.
  const visibleDocks = useMemo(() => {
    if (docks.length <= capacity) return docks;
    const keep = new Set(
      [...docks]
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, capacity)
        .map((d) => d.conversationId)
    );
    return docks.filter((d) => keep.has(d.conversationId));
  }, [docks, capacity]);

  const value = useMemo<ChatDockContextValue>(
    () => ({
      openChat,
      // En celular no hay pestañas, así que no hay nada que resaltar.
      activeConversationIds: isCompact ? [] : visibleDocks.map((d) => d.conversationId),
    }),
    [openChat, isCompact, visibleDocks]
  );

  return (
    <ChatDockContext.Provider value={value}>
      {children}

      {!isCompact && visibleDocks.length > 0 ? (
        <div
          style={{
            position: "fixed",
            insetInlineEnd: DOCK_EDGE,
            bottom: "calc(0px - var(--vb-anclaje-abajo))",
            zIndex: 1200,
            display: "flex",
            // La más reciente queda pegada al borde derecho y las anteriores se
            // van corriendo hacia la izquierda.
            flexDirection: "row-reverse",
            alignItems: "flex-end",
            gap: DOCK_GAP,
            pointerEvents: "none",
          }}
        >
          {visibleDocks.map((dock) => (
            <ChatDock
              key={dock.conversationId}
              conversationId={dock.conversationId}
              otherUid={dock.otherUid}
              profile={dock.profile}
              selfUid={selfUid}
              minimized={dock.minimized}
              closing={dock.closing}
              onToggleMinimize={() => toggleMinimize(dock.conversationId)}
              onClose={() => closeDock(dock.conversationId)}
            />
          ))}
        </div>
      ) : null}
    </ChatDockContext.Provider>
  );
}
