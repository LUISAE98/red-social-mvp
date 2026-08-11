"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useAuth } from "@/app/providers";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import ProfileMoreMenu from "@/app/[locale]/(protected)/u/[handle]/components/ProfileMoreMenu";
import { blockConversation } from "@/lib/chat/chatService";
import ConversationThread from "@/components/chat/ConversationThread";
import { useProfileMini } from "@/lib/chat/useProfileMini";
import { getOtherParticipant } from "@/lib/chat/types";

/**
 * Conversación a pantalla completa (celular).
 *
 * Se pinta en un PORTAL a `document.body`, no en su sitio del árbol. El layout
 * protegido aplica un `transform` a `.mainInner`, y eso crea un contexto de
 * apilamiento que atrapa a los `position: fixed` descendientes: por muy alto que
 * fuera el z-index, la barra inferior de navegación seguiría tapando el campo de
 * escritura. El portal es lo único que escapa de ese contexto.
 *
 * El interlocutor se deduce del propio ID del hilo (`uidA_uidB`, ordenado), así
 * que la URL no necesita llevarlo y el enlace se puede compartir tal cual.
 */
/** Misma duración que la animación de navegación global de `globals.css`. */
const NAV_ANIM_MS = 280;

export default function ConversationPage() {
  const params = useParams<{ conversationId?: string | string[] }>();
  const router = useRouter();
  const tCommon = useTranslations("common");
  const { user } = useAuth();

  const raw = params?.conversationId;
  const conversationId = Array.isArray(raw) ? raw[0] : (raw ?? null);
  const selfUid = user?.uid ?? null;

  const otherUid =
    conversationId && selfUid
      ? getOtherParticipant(conversationId.split("_"), selfUid)
      : null;

  const { profile } = useProfileMini(otherUid);
  const displayName = profile?.displayName || tCommon("user");

  const [closing, setClosing] = useState(false);
  const screenRef = useRef<HTMLDivElement | null>(null);

  // El portal solo puede montarse en cliente. Mismo patrón (y misma excepción
  // de lint) que en el resto de páginas que detectan el montaje.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  /**
   * El fondo no se mueve mientras el chat está abierto.
   *
   * No es solo higiene: si el documento de debajo puede desplazarse, iOS lo
   * desplaza al enfocar el campo de escritura para "hacer sitio" al teclado, y
   * entonces la compensación del visual viewport pelea contra ese movimiento.
   * Con el fondo quieto, lo único que se mueve es el viewport visual, que es
   * justo lo que el efecto de abajo sabe seguir.
   */
  useBodyScrollLock(mounted);

  /**
   * Ata la pantalla al VISUAL viewport, no al de diseño.
   *
   * Con el teclado abierto iOS no encoge el viewport de diseño: encoge el
   * VISUAL y lo desplaza dentro del otro. Un `position: fixed` se mide contra el
   * de diseño, así que sin compensar nada la cabecera se sale por arriba y el
   * campo de escritura queda debajo del teclado. Copiando alto y desplazamiento
   * del visual, la pantalla cae exactamente sobre lo que se ve.
   *
   * Lo frágil de esto NO es la fórmula, es CUÁNDO se aplica: iOS anima el
   * teclado unos 300ms y el último evento suele llegar antes del estado final;
   * al descartarlo con "Listo" a veces no llega ninguno. Cuando eso pasaba, la
   * pantalla se quedaba con el alto del teclado abierto y debajo aparecía una
   * franja negra — el "safe-area gigante". De ahí los reintentos escalonados
   * tras cada cambio de foco: son lo que cierra ese hueco.
   */
  useEffect(() => {
    if (!mounted) return;

    const element = screenRef.current;
    if (!element) return;

    const viewport = window.visualViewport;
    if (!viewport) return; // Sin API, se queda el 100dvh del estilo en línea.

    // El alto máximo visto es la referencia para saber si hay teclado. Comparar
    // contra `window.innerHeight` no sirve: en Safari la barra de direcciones se
    // encoge y se estira sola, y eso ya mete decenas de píxeles de diferencia
    // sin que haya ningún teclado. Un teclado nunca baja de ~200px; una barra
    // no pasa de ~100px, así que el umbral los separa sin ambigüedad.
    let maxHeight = viewport.height;

    const apply = () => {
      maxHeight = Math.max(maxHeight, viewport.height);

      element.style.height = `${viewport.height}px`;
      element.style.top = `${viewport.offsetTop}px`;

      // Con el teclado fuera no hay home-indicator que esquivar: el campo se
      // pega al teclado en vez de flotar 20px por encima. Se sobrescribe la
      // variable global solo en esta pantalla; el compositor ya la consume.
      const keyboardOpen = viewport.height < maxHeight - 120;
      if (keyboardOpen) element.style.setProperty("--vb-safe-bottom", "0px");
      else element.style.removeProperty("--vb-safe-bottom");
    };

    apply();

    /** Reaplica y vuelve a mirar mientras iOS termina de animar el teclado. */
    let timers: number[] = [];
    const applySettling = () => {
      apply();
      timers.forEach(clearTimeout);
      timers = [60, 180, 350, 600].map((ms) => window.setTimeout(apply, ms));
    };

    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", applySettling);
    // Entrar y salir del campo de escritura es lo que abre y cierra el teclado.
    element.addEventListener("focusin", applySettling);
    element.addEventListener("focusout", applySettling);

    return () => {
      timers.forEach(clearTimeout);
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", applySettling);
      element.removeEventListener("focusin", applySettling);
      element.removeEventListener("focusout", applySettling);
      element.style.removeProperty("--vb-safe-bottom");
    };
  }, [mounted]);

  /**
   * Salir: la pantalla se va deslizando a la derecha y la página de destino
   * entra desde la izquierda. Next desmonta el portal en cuanto navegas, así que
   * la salida hay que animarla ANTES de navegar — el patrón `isClosing` +
   * setTimeout de `VibraResponsivePanel`, que es la referencia de la guía.
   */
  function handleBack() {
    if (closing) return;
    setClosing(true);
    setNavSlideDir("left");
    setTimeout(() => router.back(), NAV_ANIM_MS);
  }

  if (!mounted) return null;

  const screen = (
    <div
      ref={screenRef}
      // Entrada: misma animación que el resto de la navegación. Se aplica aquí
      // y no en el layout porque el portal vive fuera de `.mainInner`, que es
      // donde el layout pone este atributo. La regla global
      // `[data-nav-enter="right"]` de globals.css hace el resto.
      data-nav-enter={closing ? undefined : "right"}
      style={{
        // La salida va inline para que gane a la regla del atributo.
        ...(closing
          ? { animation: `vibraChatExitRight ${NAV_ANIM_MS}ms ease-in both` }
          : null),
        position: "fixed",
        left: 0,
        right: 0,
        top: 0,
        // `dvh` como base y, si el navegador expone el visual viewport, se
        // afina desde el efecto: es lo que hace que al cerrarse el teclado la
        // pantalla vuelva EXACTAMENTE al fondo.
        height: "100dvh",
        // Por encima de MobileBottomNav (9999): la barra inferior taparía justo
        // el campo de escritura.
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      {/* Global: los keyframes de entrada viven en globals.css, pero el de
          salida solo lo usa esta pantalla. */}
      <style jsx global>{`
        @keyframes vibraChatExitRight {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }
      `}</style>

      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "calc(10px + env(safe-area-inset-top, 0px)) 12px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label={tCommon("back")}
          style={{
            flexShrink: 0,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "none",
            background: "transparent",
            color: "#fff",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M15 5L8 12L15 19"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* A la IZQUIERDA del avatar, igual que en la pestaña de laptop. */}
        {otherUid && conversationId ? (
          <ProfileMoreMenu
            viewerUid={selfUid}
            profileUid={otherUid}
            onBlockSuccess={() => void blockConversation(conversationId, selfUid!)}
            reportTarget={{
              targetType: "conversation",
              targetId: conversationId,
              targetOwnerId: otherUid,
            }}
            buttonStyle={{ fontSize: 20, padding: "0 2px" }}
          />
        ) : null}

        <LiveRingAvatar
          entityId={otherUid ?? conversationId ?? ""}
          entityType="profile"
          currentUserId={selfUid}
          photoURL={profile?.photoURL ?? null}
          displayName={displayName}
          size={34}
        />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {displayName}
          </div>
          {profile?.handle ? (
            <div
              style={{
                fontSize: 11.5,
                color: "rgba(255,255,255,0.45)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              @{profile.handle}
            </div>
          ) : null}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <ConversationThread
          conversationId={conversationId}
          otherUid={otherUid}
          profile={profile}
          selfUid={selfUid}
          safeAreaBottom
        />
      </div>
    </div>
  );

  return createPortal(screen, document.body);
}
