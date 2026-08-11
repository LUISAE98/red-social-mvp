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
   * DOS decisiones aquí son las que hacen que esto funcione en iOS:
   *
   * 1. Sin teclado NO se escribe ningún número: se devuelve la pantalla al CSS
   *    (`top: 0` + `100dvh`), que por definición es "su sitio". Antes se escribía
   *    el alto medido también al cerrar, y bastaba que iOS lo reportase tarde
   *    para que la pantalla se quedase corta y apareciera una franja negra
   *    abajo. Un valor que no se escribe no se puede quedar a medias.
   *
   * 2. No basta con reaccionar a los eventos. iOS anima el teclado ~300ms y el
   *    último evento suele llegar ANTES del estado final; al descartarlo con el
   *    botón del propio teclado a veces no llega ninguno. Por eso ante cualquier
   *    señal se arranca un seguimiento por frames que LEE el viewport hasta que
   *    deja de moverse, en vez de esperar a que alguien nos avise.
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
      const keyboardOpen = viewport.height < maxHeight - 120;

      if (keyboardOpen) {
        element.style.height = `${viewport.height}px`;
        element.style.top = `${viewport.offsetTop}px`;
        // Con teclado no hay home-indicator que esquivar: el campo se pega a él
        // en vez de flotar 20px por encima. Se sobrescribe la variable global
        // solo en esta pantalla; el compositor ya la consume.
        element.style.setProperty("--vb-safe-bottom", "0px");
      } else {
        // Valores fijos y NO `removeProperty`: el alto de partida lo pone React
        // en el atributo `style`, y React solo reescribe lo que cambia entre
        // renders — si se quitara aquí, no lo repondría y la pantalla se
        // quedaría sin alto.
        element.style.height = "100dvh";
        element.style.top = "0px";
        element.style.removeProperty("--vb-safe-bottom");
      }
    };

    apply();

    /**
     * Sigue al viewport frame a frame hasta que se queda quieto (300ms sin
     * moverse), con un tope de 2s por si acaso. Es lo que cubre el caso de que
     * el evento no llegue nunca o llegue con un valor a medio camino.
     */
    let frame = 0;
    const track = () => {
      cancelAnimationFrame(frame);

      const startedAt = performance.now();
      let lastHeight = -1;
      let lastOffset = -1;
      let stillSince = startedAt;

      const step = () => {
        apply();

        const now = performance.now();
        if (viewport.height !== lastHeight || viewport.offsetTop !== lastOffset) {
          lastHeight = viewport.height;
          lastOffset = viewport.offsetTop;
          stillSince = now;
        }

        if (now - stillSince < 300 && now - startedAt < 2000) {
          frame = requestAnimationFrame(step);
        }
      };

      frame = requestAnimationFrame(step);
    };

    // Al girar, el alto de referencia ya no vale: en horizontal la pantalla mide
    // casi la mitad y sin reiniciarlo se leería como "hay teclado".
    const onOrientation = () => {
      maxHeight = 0;
      track();
    };

    viewport.addEventListener("resize", track);
    viewport.addEventListener("scroll", track);
    window.addEventListener("orientationchange", onOrientation);
    // Entrar y salir del campo de escritura es lo que abre y cierra el teclado.
    element.addEventListener("focusin", track);
    element.addEventListener("focusout", track);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", track);
      viewport.removeEventListener("scroll", track);
      window.removeEventListener("orientationchange", onOrientation);
      element.removeEventListener("focusin", track);
      element.removeEventListener("focusout", track);
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

        {/* En el EXTREMO derecho. En la pestaña de laptop sigue a la izquierda
            del avatar: allí la cabecera es estrecha y el borde derecho lo ocupan
            minimizar y cerrar. Aquí hay ancho de sobra y el pulgar llega mejor. */}
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
