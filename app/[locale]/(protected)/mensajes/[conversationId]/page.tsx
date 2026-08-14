"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useVisualViewport } from "@/lib/hooks/useVisualViewport";
import { useAuth } from "@/app/providers";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import ProfileMoreMenu from "@/app/[locale]/(protected)/u/[handle]/components/ProfileMoreMenu";
import ConversationThread from "@/components/chat/ConversationThread";
import {
  ChatConversationMenuItems,
  ChatRemoveConversationDialog,
} from "@/components/chat/ChatConversationActions";
import { useConversationDoc } from "@/lib/chat/useConversationDoc";
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
  // Solo para saber si el hilo está silenciado; el propio hilo ya se suscribe
  // por su cuenta y el listener es el mismo documento.
  const { conversation } = useConversationDoc(conversationId);
  const displayName = profile?.displayName || tCommon("user");

  const [closing, setClosing] = useState(false);
  /**
   * Vive AQUÍ y no dentro del menú: el menú se desmonta al cerrarse, y con él
   * se llevaba el panel de confirmación a los pocos milisegundos de abrirlo.
   */
  const [removeOpen, setRemoveOpen] = useState(false);

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
   * Geometría de la pantalla frente al teclado.
   *
   * En iOS el teclado NO encoge el viewport de LAYOUT, que es contra el que se
   * ancla un "position: fixed": solo encoge el VISUAL y lo desplaza dentro del
   * otro. Sin compensarlo, la cabecera se sale por arriba y el campo de
   * escritura queda debajo del teclado.
   *
   * Se resuelve con "useVisualViewport" y con la MISMA forma que el panel de
   * comentarios, que es el patrón que ya funciona en el resto de la plataforma:
   *
   *  - Con teclado: "top"/"height" del viewport visual, así la pantalla calza
   *    exactamente el área que se ve.
   *  - Sin teclado: "inset: 0" y NINGÚN número. Estira el propio viewport.
   *
   * Ese segundo punto es el que estaba roto. Antes se escribía un alto medido (o
   * "100dvh") también al cerrar, y a mano sobre el nodo. Como React no reescribe
   * un estilo que no cambia entre renders, ese valor se quedaba pegado y salía la
   * franja negra abajo. Declarándolo, cerrar el teclado BORRA "top"/"height" en
   * vez de recalcularlos: no queda número que pueda envejecer.
   */
  /**
   * Y ADEMÁS el campo tiene que tener el foco.
   *
   * Sin esta segunda condición seguía apareciendo la franja negra en Safari: si
   * iOS no emite el evento de `visualViewport` al retirarse el teclado — y a
   * veces no lo emite —, la geometría se queda con el alto de cuando estaba
   * abierto y la pantalla no vuelve al borde. El foco no depende de ese evento:
   * si el campo se soltó, no hay teclado, punto. Da igual lo que diga la
   * geometría rezagada.
   */
  const [composerFocused, setComposerFocused] = useState(false);

  // El foco se le pasa al hook como aviso: es la señal de que la geometría va a
  // moverse, y con ella el hook vuelve a leerla varias veces mientras el teclado
  // se va, en vez de esperar un evento que iOS puede no mandar.
  const viewport = useVisualViewport(composerFocused);
  const keyboardPx =
    viewport != null && typeof window !== "undefined"
      ? Math.max(0, Math.round(window.innerHeight - viewport.height))
      : 0;
  // Mismo umbral que el resto del producto: la barra del navegador ya deja
  // 40-80px de diferencia sin que haya ningún teclado.
  const keyboardFitsGeometry = keyboardPx > 120;

  const keyboardOpen = composerFocused && keyboardFitsGeometry;

  /**
   * El viewport visual puede quedarse CORRIDO aunque no haya teclado.
   *
   * Mientras el chat está abierto el fondo va bloqueado con `overflow: hidden`,
   * así que iOS no puede desplazar el DOCUMENTO para hacerle sitio al teclado y
   * desplaza el viewport VISUAL dentro del de layout. Al cerrarse no siempre lo
   * devuelve a cero.
   *
   * Antes, sin teclado se caía a `inset: 0` sin mirar esto, y `inset: 0` ancla al
   * viewport de LAYOUT: la pantalla quedaba calzada contra un área distinta de la
   * que se ve, el campo de escritura no volvía abajo y salía la franja. Mientras
   * siga corrido hay que seguir calzando el área visible, haya teclado o no.
   */
  const viewportCorrido = viewport != null && viewport.offsetTop > 0;
  const calzarAreaVisible = (keyboardOpen || viewportCorrido) && viewport != null;

  /** Lector de geometría en pantalla, solo con `?vv=1`. Ver más abajo. */
  const depurarViewport =
    mounted && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).has("vv")
      : false;

  /** Dónde estaba el documento al entrar. Es el sitio al que hay que devolverlo. */
  const baseScrollRef = useRef(0);
  useEffect(() => {
    baseScrollRef.current = window.scrollY;
  }, []);

  /**
   * Devuelve el DOCUMENTO a su sitio cuando el teclado se retira.
   *
   * Esta es la causa de la franja que aparece SOLO tras abrir y cerrar el
   * teclado, y que no está al entrar: iOS desplaza el documento al enfocar el
   * campo, para "hacer sitio", y al cerrarse no siempre lo devuelve. Un
   * `position: fixed` se ancla al viewport de LAYOUT, así que ese desplazamiento
   * sobrante se ve como un hueco bajo el panel — aunque el panel siga midiendo
   * exactamente lo que debe.
   *
   * No basta con corregirlo una vez al perder el foco: iOS termina de mover las
   * cosas DESPUÉS, mientras el teclado se va. Por eso se queda escuchando el
   * viewport hasta que deja de moverse.
   *
   * Se devuelve a la posición que tenía al entrar, NO a cero: así el feed que
   * hay debajo no pierde dónde estaba al salir del chat.
   *
   * ⚠️ Ojo con lo que este efecto puede y no puede arreglar. Mientras el chat está
   * abierto el fondo va bloqueado con `overflow: hidden`, así que el documento NO
   * se puede desplazar y `window.scrollY` se queda en su valor de entrada pase lo
   * que pase: aquí dentro esto casi nunca tiene nada que hacer. Lo que iOS mueve
   * en ese caso es el viewport VISUAL, y eso no se corrige desplazando el
   * documento sino calzando la pantalla al área visible (`calzarAreaVisible`).
   * Este efecto cubre el otro escenario, el de que el documento sí se haya
   * movido, y sobre todo la salida (ver el efecto de desmontaje de abajo).
   */
  useEffect(() => {
    if (!mounted) return;

    const restore = () => {
      // Con el teclado abierto ese desplazamiento es de iOS y hace falta.
      if (composerFocused) return;
      if (window.scrollY === baseScrollRef.current) return;
      window.scrollTo(0, baseScrollRef.current);
    };

    restore();

    const vv = window.visualViewport;
    vv?.addEventListener("scroll", restore);
    vv?.addEventListener("resize", restore);
    window.addEventListener("scroll", restore);

    return () => {
      vv?.removeEventListener("scroll", restore);
      vv?.removeEventListener("resize", restore);
      window.removeEventListener("scroll", restore);
    };
  }, [mounted, composerFocused]);

  /**
   * Al SALIR del chat, devolver el documento a su sitio pase lo que pase.
   *
   * El efecto de arriba se sale por el guard de foco, así que si se navega con el
   * campo todavía enfocado —que es justo lo que pasa al darle a atrás nada más
   * escribir— nunca llegaba a corregir nada, y el desplazamiento que había puesto
   * iOS se arrastraba a la lista de chats: el nav aparecía impulsado hacia arriba
   * como si hubiera un segundo safe-area, y no se enderezaba hasta navegar a otra
   * sección.
   *
   * Va SIN dependencias para que corra solo al desmontar, y DESPUÉS del
   * `useBodyScrollLock` de arriba: React limpia los efectos en el orden en que se
   * declararon, así que para cuando esto corre el fondo ya está desbloqueado y el
   * documento vuelve a poder desplazarse.
   */
  useEffect(() => {
    return () => {
      if (window.scrollY !== baseScrollRef.current) {
        window.scrollTo(0, baseScrollRef.current);
      }
    };
  }, []);

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
      // Entrada: misma animación que el resto de la navegación. Se aplica aquí
      // y no en el layout porque el portal vive fuera de `.mainInner`, que es
      // donde el layout pone este atributo. La regla global
      // `[data-nav-enter="right"]` de globals.css hace el resto.
      data-nav-enter={closing ? undefined : "right"}
      // `onFocus`/`onBlur` de React son focusin/focusout: burbujean, así que se
      // enteran del campo de escritura sin tener que pasarle nada al hilo.
      onFocus={() => setComposerFocused(true)}
      onBlur={() => setComposerFocused(false)}
      style={{
        // La salida va inline para que gane a la regla del atributo.
        ...(closing
          ? { animation: `vibraChatExitRight ${NAV_ANIM_MS}ms ease-in both` }
          : null),
        position: "fixed",
        // Con teclado, el área visible exacta. Sin teclado, `inset: 0` y ni un
        // número: es la diferencia entre que al cerrarlo vuelva al borde o se
        // quede una franja negra abajo.
        ...(calzarAreaVisible && viewport
          ? {
              top: viewport.offsetTop,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              height: viewport.height,
              bottom: "auto" as const,
            }
          : { inset: 0 }),
        // El DM se sale del safe-area inferior, a propósito y SIEMPRE.
        //
        // `--vb-safe-bottom` son 20px fijos para todo el producto (los pone
        // `body.vb-authed`), pensados para superficies que conviven con la barra
        // inferior. Esta no: ocupa la pantalla entera y el campo de escritura es
        // su borde. Reservando esos 20px quedaban sumados al hueco físico del
        // home-indicator, y el resultado se leía como dos safe-areas apiladas.
        //
        // Se sobrescribe solo para esta pantalla; el resto del producto y la
        // pestaña de laptop conservan la suya.
        //
        // El `as` es porque los tipos de React no admiten propiedades
        // personalizadas en el objeto de estilos.
        ...({ "--vb-safe-bottom": "0px" } as React.CSSProperties),
        // Por encima de MobileBottomNav (9999): la barra inferior taparía justo
        // el campo de escritura.
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      {/* Lector de geometría para depurar el teclado en iOS. Solo aparece con
          `?vv=1` en la URL, porque este fallo únicamente se reproduce en un
          iPhone de verdad y desde el escritorio no hay forma de mirarlo. Si
          `corrido` se queda en un número distinto de 0 con el teclado ya cerrado,
          es que iOS no devolvió el viewport visual a su sitio. */}
      {depurarViewport ? (
        <div
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 4px)",
            insetInlineEnd: 4,
            zIndex: 10001,
            pointerEvents: "none",
            background: "rgba(0,0,0,0.72)",
            color: "#0f0",
            font: "600 10px/1.35 ui-monospace, monospace",
            padding: "4px 6px",
            borderRadius: 6,
            whiteSpace: "pre",
          }}
        >
          {[
            `corrido ${viewport?.offsetTop ?? "—"}`,
            `alto vv ${viewport?.height ?? "—"}`,
            `alto win ${typeof window !== "undefined" ? window.innerHeight : "—"}`,
            `teclado ${keyboardPx}`,
            `foco ${composerFocused ? "sí" : "no"}`,
            `calza ${calzarAreaVisible ? "sí" : "no"}`,
          ].join("\n")}
        </div>
      ) : null}

      {/* Global: los keyframes de entrada viven en globals.css, pero el de
          salida solo lo usa esta pantalla. */}
      <style jsx global>{`
        @keyframes vibraChatExitRight {
          from {
            transform: translateX(0);
          }
          to {
            /* El signo sale de --vb-dir (globals.css): en árabe y dhivehi la
               pantalla tiene que salir hacia la izquierda para que se lea como
               retroceder. translateX no se voltea solo, no es una propiedad
               lógica. */
            transform: translateX(calc(100% * var(--vb-dir, 1)));
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

        {/* A la derecha, pero SEPARADO del borde: pegado a él el dedo se sale de
            la pantalla al intentar darle. Los 6px de margen más el relleno
            propio del botón dejan un blanco cómodo.
            En la pestaña de laptop sigue a la izquierda del avatar: allí la
            cabecera es estrecha y el borde derecho lo ocupan minimizar y cerrar. */}
        {otherUid && conversationId ? (
          <ProfileMoreMenu
            viewerUid={selfUid}
            profileUid={otherUid}
            // Bloquear/desbloquear NO se cablea aquí: el estado del hilo lo
            // sincroniza `useSocialRelationship`, que es por donde pasan todos
            // los bloqueos. Hacerlo también aquí sería escribir dos veces.
            reportTarget={{
              targetType: "conversation",
              targetId: conversationId,
              targetOwnerId: otherUid,
            }}
            buttonStyle={{ fontSize: 20, padding: "0 8px", marginInlineEnd: 6 }}
            extraItems={({ close, itemStyle }) =>
              selfUid ? (
                <ChatConversationMenuItems
                  conversationId={conversationId}
                  selfUid={selfUid}
                  muted={(conversation?.mutedBy ?? []).includes(selfUid)}
                  itemStyle={itemStyle}
                  onCloseMenu={close}
                  onRequestRemove={() => setRemoveOpen(true)}
                />
              ) : null
            }
          />
        ) : null}
      </header>

      {selfUid && conversationId ? (
        <ChatRemoveConversationDialog
          open={removeOpen}
          conversationId={conversationId}
          selfUid={selfUid}
          onClose={() => setRemoveOpen(false)}
          // Quitada de la bandeja, quedarse dentro del hilo no tiene sentido.
          onRemoved={handleBack}
        />
      ) : null}

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
