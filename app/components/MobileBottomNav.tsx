"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { db } from "@/lib/firebase";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { usePendingExperiences } from "@/lib/wallet/usePendingExperiences";
import { useExperiencesSeen } from "@/lib/experiences/useExperiencesSeen";
import { useInbox } from "@/lib/chat/useInbox";

type NavIconKey =
  | "home"
  | "reels"
  | "groups"
  | "messages"
  | "notifications"
  | "wallet";

type MobileNavItem = {
  key: string;
  href: string;
  active: boolean;
  label: string;
  type: "icon" | "avatar";
  iconKey?: NavIconKey;
};

/* ─── Iconos del nav ─────────────────────────────────────────────────────────
 *
 * Se rediseñaron como CONJUNTO, no uno a uno. Antes cada icono había nacido por
 * su cuenta y no compartían nada: la casa medía 16 de alto, el marco de reels 18,
 * la cartera 18 de ancho y el globo 17, así que a simple vista unos pesaban más
 * que otros aunque el lienzo fuese el mismo.
 *
 * Las tres reglas que ahora comparten TODOS:
 *
 *   1. Caja óptica de 16.8 × 16.8, centrada en el lienzo de 24. Es decir, todos
 *      viven entre 3.6 y 20.4 en los dos ejes. Ese es el motivo real de que se
 *      vean del mismo tamaño; el `width` del svg nunca lo fue.
 *   2. Trazo de 1.8, con extremos y uniones redondeados. El 2 de antes se veía
 *      tosco a este tamaño y comía el detalle interior.
 *   3. Radios de esquina generosos —entre 3 y 4.6— para que la familia se lea
 *      redondeada y no a medio camino entre recta y curva.
 *
 * La versión rellena repite la MISMA silueta con `fill`, en vez de dibujar otra
 * forma. Así el paso de inactivo a activo no cambia de icono, solo lo llena.
 */

const NAV_ICON = {
  width: 30,
  height: 30,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "#ffffff",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Casa: tejado, cuerpo y una puerta de arco. */
const HOME_ROOF = "M3.9 10.6 12 3.9l8.1 6.7";
const HOME_BODY = "M5.9 9.4v9.1a1.9 1.9 0 0 0 1.9 1.9h8.4a1.9 1.9 0 0 0 1.9-1.9V9.4";
const HOME_DOOR = "M10.2 20.4v-4a1.8 1.8 0 0 1 3.6 0v4";

function NavHomeIcon() {
  return (
    <svg {...NAV_ICON}>
      <path d={HOME_ROOF} />
      <path d={HOME_BODY} />
      <path d={HOME_DOOR} />
    </svg>
  );
}

/** Silueta cerrada de la casa, para la versión rellena. */
const HOME_FILL = "M12 3.9 20.1 10.6V18.5a1.9 1.9 0 0 1-1.9 1.9H5.8a1.9 1.9 0 0 1-1.9-1.9V10.6Z";

function NavHomeIconFilled() {
  return (
    <svg {...NAV_ICON}>
      {/* El MISMO icono, invertido. En vez de pintar el detalle interior encima
          del relleno —que obligaba a darle un color y por eso salía negro—, se
          recorta con una máscara: lo que ahí va en negro no se dibuja nunca, solo
          marca dónde NO pintar. Así la puerta es un hueco transparente y se ve
          la barra a través, exactamente igual que en la versión de trazo. */}
      <mask id="vibraNavHomeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <path
          d={HOME_DOOR}
          fill="none"
          stroke="#000"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <g mask="url(#vibraNavHomeMask)">
        <path d={HOME_FILL} fill="#fff" stroke="#fff" />
        {/* Devuelve el alero, que en la silueta cerrada se perdía. */}
        <path d={HOME_ROOF} fill="none" stroke="#fff" />
      </g>
    </svg>
  );
}

/** Reels: un cuadro con la flecha de reproducir dentro. */
function NavReelsIcon() {
  return (
    <svg {...NAV_ICON}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.6" />
      <path d="M10.4 9.1 15.6 12l-5.2 2.9z" />
    </svg>
  );
}

function NavReelsIconFilled() {
  return (
    <svg {...NAV_ICON}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.6" fill="white" />
      <path d="M10.4 9.1 15.6 12l-5.2 2.9z" fill="#000000" stroke="#000000" />
    </svg>
  );
}

/** Mensajes: globo de conversación con la cola abajo a la izquierda. */
const MESSAGES_BUBBLE =
  "M12 3.9c-4.6 0-8.4 3-8.4 6.7 0 1.9.9 3.5 2.4 4.7l-.9 3.9a.6.6 0 0 0 .9.6l4.1-2.1c.6.1 1.2.1 1.9.1 4.6 0 8.4-3 8.4-6.7S16.6 3.9 12 3.9Z";

function NavMessagesIcon() {
  return (
    <svg {...NAV_ICON}>
      <path d={MESSAGES_BUBBLE} />
    </svg>
  );
}

function NavMessagesIconFilled() {
  return (
    <svg {...NAV_ICON}>
      <path d={MESSAGES_BUBBLE} fill="white" stroke="white" />
    </svg>
  );
}

/** Campana: cuerpo y badajo. */
const BELL_BODY =
  "M12 3.9a5.8 5.8 0 0 0-5.8 5.8c0 4.9-2.1 6.3-2.1 6.3h15.8s-2.1-1.4-2.1-6.3A5.8 5.8 0 0 0 12 3.9Z";
const BELL_CLAPPER = "M10.2 18.6a2 2 0 0 0 3.6 0";

function NavBellIcon() {
  return (
    <svg {...NAV_ICON}>
      <path d={BELL_BODY} />
      <path d={BELL_CLAPPER} />
    </svg>
  );
}

function NavBellIconFilled() {
  return (
    <svg {...NAV_ICON}>
      <path d={BELL_BODY} fill="white" stroke="white" />
      <path d={BELL_CLAPPER} />
    </svg>
  );
}

/** Cartera: cuerpo y el botón del cierre a la derecha. */
function NavWalletIcon() {
  return (
    <svg {...NAV_ICON}>
      <rect x="3.6" y="4.9" width="16.8" height="14.2" rx="3.4" />
      <path d="M3.6 8.4h16.8" />
      <path d="M16.3 13.6h1.6" />
    </svg>
  );
}

function NavWalletIconFilled() {
  return (
    <svg {...NAV_ICON}>
      {/* Mismo recurso que la casa: la costura y el botón del cierre se recortan
          con máscara, así que quedan transparentes en vez de negros. */}
      <mask id="vibraNavWalletMask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <path
          d="M3.6 8.4h16.8M16.3 13.6h1.6"
          fill="none"
          stroke="#000"
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </mask>
      <rect
        x="3.6"
        y="4.9"
        width="16.8"
        height="14.2"
        rx="3.4"
        fill="#fff"
        stroke="#fff"
        mask="url(#vibraNavWalletMask)"
      />
    </svg>
  );
}

/** Comunidades: tres personas en triángulo. */
const GROUPS_TOP = "M12 3.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Z";
const GROUPS_LEFT = "M6.5 11.7a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Z";
const GROUPS_RIGHT = "M17.5 11.7a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Z";
const GROUPS_LINKS = "M9.5 9.4 8.2 11.9M14.5 9.4l1.3 2.5M9.4 17.2h5.2";

function NavGroupsIcon() {
  return (
    <svg {...NAV_ICON}>
      <path d={GROUPS_TOP} />
      <path d={GROUPS_LEFT} />
      <path d={GROUPS_RIGHT} />
      <path d={GROUPS_LINKS} strokeWidth={1.4} />
    </svg>
  );
}

function NavGroupsIconFilled() {
  return (
    <svg {...NAV_ICON}>
      <path d={GROUPS_TOP} fill="white" stroke="white" />
      <path d={GROUPS_LEFT} fill="white" stroke="white" />
      <path d={GROUPS_RIGHT} fill="white" stroke="white" />
      <path d={GROUPS_LINKS} strokeWidth={1.4} />
    </svg>
  );
}

function ProfileAvatarIcon({
  src,
  active,
}: {
  src: string | null;
  active: boolean;
}) {
  const size = 38;

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.12)",
        border: active
          ? "2px solid #ffffff"
          : "1.5px solid rgba(255,255,255,0.6)",
        flexShrink: 0,
      }}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={size}
          height={size}
          style={{
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <span style={{ fontSize: 14, lineHeight: 1, fontWeight: 800, color: "#fff" }}>
          U
        </span>
      )}
    </span>
  );
}

/**
 * Cuánto encoge la píldora al bajar el scroll o tras cinco segundos quieta.
 *
 * Uniforme y suave a propósito: la idea es que ceda protagonismo mientras lees,
 * no que desaparezca. Con el 0.75 de antes —que solo aplastaba en vertical— una
 * píldora se deformaría y perdería su forma redonda.
 */
const NAV_SHRUNK_SCALE = 0.88;

/**
 * Pantallas con cabecera propia y feed largo debajo: un perfil, el tuyo o el de
 * otra persona, y una comunidad. En ellas el avatar del nav sube al principio
 * antes de abrir el menú, que es el atajo que antes daba la flecha flotante.
 *
 * `/groups/new` es un formulario y `/groups` a secas es el índice: ninguno de los
 * dos tiene nada que recorrer.
 */
function isScrollableFeed(pathname: string): boolean {
  if (/^\/u\/[^/]+/.test(pathname)) return true;
  if (pathname === "/groups/new" || pathname === "/groups") return false;
  return /^\/groups\/[^/]+/.test(pathname);
}

export default function MobileBottomNav({
  showWallet = false,
}: {
  showWallet?: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { badgeCount } = useNotifications(user?.uid ?? null);
  // No leídos del DM, para el badge de Mensajes.
  const { unreadTotal: unreadMessages } = useInbox(user?.uid ?? null);

  // El badge del icono de notificaciones también avisa por experiencias nuevas
  // sin ver (saludos/consejos vendidos, sesiones por atender) — que se cuentan
  // aparte de la colección `notifications`. Igual que la campanita de escritorio.
  // `useWalletVisibility` (cacheado) evita abrir listeners a quien no vende.
  const { hasWallet } = useWalletVisibility(user?.uid ?? null);
  const { pendingMsList } = usePendingExperiences(hasWallet ? user?.uid ?? null : null);
  const { seenAt: expSeenAt } = useExperiencesSeen(hasWallet ? user?.uid ?? null : null);
  // Solo las experiencias NUEVAS (sin ver), no el total pendiente.
  const newExperiencesCount = useMemo(
    () => pendingMsList.filter((ms) => ms > expSeenAt).length,
    [pendingMsList, expSeenAt]
  );
  const notifAlertCount = badgeCount + newExperiencesCount;

  const [handle, setHandle] = useState<string | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Clear pending when real navigation completes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPendingHref(null); }, [pathname]);

  // ── Nav scale (shrink on scroll-down / idle) ───────────────────────────────
  const [navScale, setNavScale] = useState(1);
  const [poppingKey, setPoppingKey] = useState<string | null>(null);
  const [shakingKey, setShakingKey] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollYRef = useRef(0);

  const cancelIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const startIdleTimer = useCallback(() => {
    cancelIdleTimer();
    idleTimerRef.current = setTimeout(() => setNavScale(NAV_SHRUNK_SCALE), 5000);
  }, [cancelIdleTimer]);

  const expandNav = useCallback(() => {
    setNavScale(1);
    startIdleTimer();
  }, [startIdleTimer]);

  useEffect(() => {
    startIdleTimer();

    function onScroll() {
      const y = window.scrollY;
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;
      if (Math.abs(dy) < 2) return;
      if (dy > 0) {
        cancelIdleTimer();
        setNavScale(NAV_SHRUNK_SCALE);
      } else {
        setNavScale(1);
        startIdleTimer();
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelIdleTimer();
    };
  }, [startIdleTimer, cancelIdleTimer]);

  /**
   * Publica el alto REAL del nav en `--vb-bottom-nav-h`, para que el clearance
   * del contenido no tenga que adivinarlo.
   *
   * Hace falta porque el nav no mide siempre lo mismo: se encoge a 0.75 al bajar
   * o tras cinco segundos quieto. Un clearance de número fijo se calibra con el
   * nav expandido (70px + safe-area) y, justo cuando llegas al final del scroll
   * —que es cuando el nav está encogido—, sobran ~23px de vacío. Es el mismo
   * problema que ya resolvió `ReelFeed` para apartar sus botones.
   *
   * ⚠️ El encogido es `transform: scaleY`, y un transform NO dispara
   * ResizeObserver: solo cambia la caja pintada, no la de layout. Por eso
   * mientras dura la transición se muestrea cada fotograma. `getBoundingClientRect`
   * sí devuelve la caja ya transformada.
   */
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const read = () => {
      const h = nav.getBoundingClientRect().height;
      // Altura 0 = el nav no se pinta (laptop, o modal abierto que lo esconde).
      // Se conserva el último valor bueno: bajarlo a 0 encogería el contenido y
      // daría un tirón al cerrar el modal.
      if (h > 0) {
        document.documentElement.style.setProperty("--vb-bottom-nav-h", `${h}px`);
      }
    };
    read();

    let raf = 0;
    const follow = () => {
      read();
      raf = requestAnimationFrame(follow);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(follow);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      read();
    };

    // El transform vive en un hijo, así que los eventos llegan por burbujeo.
    nav.addEventListener("transitionstart", start);
    nav.addEventListener("transitionend", stop);
    nav.addEventListener("transitioncancel", stop);

    // Cubre además lo que sí mueve la caja de layout: rotación, safe-area.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(nav);

    return () => {
      stop();
      nav.removeEventListener("transitionstart", start);
      nav.removeEventListener("transitionend", stop);
      nav.removeEventListener("transitioncancel", stop);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    async function loadProfileData() {
      if (!user) {
        setHandle(null);
        setPhotoURL(null);
        return;
      }

      const uid = user.uid;
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          const data = snap.data() as {
            handle?: string;
            photoURL?: string;
            avatarUrl?: string;
            avatarURL?: string;
          };
          setHandle(data.handle ?? null);
          setPhotoURL(data.photoURL ?? data.avatarUrl ?? data.avatarURL ?? null);
        } else {
          setHandle(null);
          setPhotoURL(null);
        }
      } catch {
        setHandle(null);
        setPhotoURL(null);
      }
    }

    loadProfileData();
  }, [user]);

  // El avatar ya no lleva al perfil sino al menú; sin sesión no hay menú que
  // abrir, así que cae en el login igual que antes.
  const menuHref = user ? "/menu" : "/login";

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const nav = useMemo(() => {
    const items: MobileNavItem[] = [
      {
        key: "home",
        href: "/",
        active: pathname === "/" || pathname === "/home" || pathname.startsWith("/feed"),
        label: t("home"),
        type: "icon",
        iconKey: "home",
      },
      // Historias, pegado a home. El rail de historias del home desapareció en
      // celular y su contenido vive aquí, a pantalla completa.
      {
        key: "reels",
        href: "/reels",
        active: pathname.startsWith("/reels"),
        label: t("reels"),
        type: "icon",
        iconKey: "reels",
      },
      // Las comunidades pasaron al menú del avatar (`/menu`), que es donde vive
      // el OwnerSidebar.
      {
        key: "messages",
        href: "/mensajes",
        active: pathname.startsWith("/mensajes"),
        label: t("tabMessages"),
        type: "icon",
        iconKey: "messages",
      },
    ];

    items.push({
      key: "notifications",
      href: "/notifications",
      active: pathname.startsWith("/notifications"),
      label: t("notifications"),
      type: "icon",
      iconKey: "notifications",
    });

    // "Mis experiencias" ya NO vive aquí: se movió al menú del avatar
    // (OwnerSidebar), encima de "Crea tu comunidad". En laptop está en el
    // menú lateral derecho. En los dos sitios lleva su globo con el número,
    // que aquí no cabía: el nav inferior solo tiene sitio para un punto.

    if (showWallet) {
      items.push({
        key: "wallet",
        href: "/wallet/finanzas",
        active: pathname.startsWith("/wallet"),
        label: t("wallet"),
        type: "icon",
        iconKey: "wallet",
      });
    }

    // El avatar abre TU MENÚ, no el perfil: dentro está la tarjeta de tu perfil
    // (y es ella la que lleva a `/u/{handle}`), a quién sigues y tus comunidades.
    items.push({
      key: "profile",
      href: menuHref,
      active:
        pathname.startsWith("/menu") ||
        (handle ? pathname === `/u/${handle}` || pathname.startsWith(`/u/${handle}/`) : false),
      label: t("profile"),
      type: "avatar",
    });

    return items;
  }, [pathname, menuHref, handle, showWallet]);

  /**
   * En qué columna está la pestaña activa. Es lo único que necesita la burbuja
   * para colocarse: la rejilla reparte columnas iguales, así que con el índice
   * basta y no hay que medir nada.
   *
   * Manda `pendingHref` cuando lo hay —el destino que acabas de tocar—, igual
   * que el resaltado del icono. Así la burbuja arranca con el toque y no
   * espera a que la ruta termine de cambiar.
   *
   * Devuelve -1 si ninguna coincide (una ruta que no está en la barra); ahí la
   * burbuja se esconde en vez de quedarse marcando una pestaña que no toca.
   */
  const activeIndex = useMemo(() => {
    if (pendingHref !== null) {
      const i = nav.findIndex((item) => item.href === pendingHref);
      if (i >= 0) return i;
    }
    return nav.findIndex((item) => item.active);
  }, [nav, pendingHref]);

  return (
    <>
      <style jsx>{`
        .wrap {
          position: fixed;
          inset-inline-start: 0;
          inset-inline-end: 0;
          bottom: 0;
          z-index: 9999;
          display: none;
          width: 100%;
          /* El aire alrededor de la píldora va como PADDING del contenedor, no
             como margen de la píldora: el alto de este contenedor es lo que se
             publica en --vb-bottom-nav-h, y un margen se colapsaría fuera de esa
             medida dejando el clearance del contenido corto. */
          padding: 0 12px calc(18px + var(--vb-safe-bottom, 0px));
          box-sizing: border-box;
          /* SIN transform 3D aquí. Un translateZ forma una RAIZ DE BACKDROP, y
             entonces el desenfoque de la píldora no tiene nada que difuminar:
             el fondo translúcido se veía plano, sin cristal. La promoción a
             capa la sigue dando el propio transform de la píldora, que se anima
             al encoger. */
          pointer-events: none;
          view-transition-name: mobile-nav;
        }

        /* La píldora flotante. No toca ningún canto: se apoya sobre el contenido,
           que se ve difuminado por detrás. */
        .navShell {
          width: 100%;
          pointer-events: auto;
          box-sizing: border-box;
          border-radius: 20px;
          /* Cristal: base translúcida + un degradado de luz encima. El
             degradado es lo que le da relieve — arriba entra la luz y abajo se
             apaga—, y sin él un fondo translúcido se ve como una lámina plana. */
          background:
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.08) 0%,
              rgba(255, 255, 255, 0.02) 42%,
              rgba(0, 0, 0, 0.18) 100%
            ),
            rgba(10, 10, 14, 0.68);
          /* El contorno se apoya sobre un cristal ya bastante oscuro, así que un
             borde al 14% se leía como una línea dibujada y no como un filo. Con
             el fondo tan ahumado, el volumen lo dan las sombras; el borde solo
             tiene que insinuar dónde acaba. */
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            inset 0 -1px 0 rgba(0, 0, 0, 0.22),
            0 6px 14px rgba(0, 0, 0, 0.34),
            0 22px 48px rgba(0, 0, 0, 0.52);
          /* Más desenfoque y algo de brillo a la baja: lo que pasa por detrás
             tiene que quedar irreconocible, no solo suavizado. Con 26 y una base
             al 52% una foto clara se leía a través y la píldora desaparecía. */
          /* Cristal AHUMADO. Tres cosas distintas, y conviene no confundirlas:
             el desenfoque hace ilegible lo de detrás, el brillo lo oscurece y la
             capa opaca de arriba lo tapa. Para que se vea oscuro y borroso pero
             se siga notando que hay algo pasando, el peso va en los dos primeros
             y la capa opaca se queda a media altura. */
          backdrop-filter: blur(64px) saturate(140%) brightness(0.36);
          -webkit-backdrop-filter: blur(64px) saturate(140%) brightness(0.36);
          /* SIN overflow:hidden. Los globos de aviso se dibujan fuera de su
             icono (top:-5px, inset-inline-end:-8px) y en el primer y el ultimo
             elemento caerian justo sobre el borde: recortarlos los partiria por
             la mitad. Los hijos no tienen fondo, asi que no hay nada que la
             curva del borde necesite recortar. */
        }

        .nav {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(var(--mobile-nav-count), minmax(0, 1fr));
          align-items: center;
          /* Sin fondo propio: el de la píldora es el que se ve. El safe-area ya
             lo reserva el contenedor. */
          padding: 5px 6px;
          background: transparent;
          box-sizing: border-box;
          /* Ancla de la burbuja, que va en posición absoluta dentro. */
          position: relative;
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
        }

        /* ── Burbuja del elemento activo ──────────────────────────────────────
           Se desliza de un icono a otro en vez de aparecer y desaparecer.

           No se mide nada con JavaScript: la rejilla reparte columnas IGUALES,
           así que la burbuja mide una columna y se mueve tantas columnas como
           diga el índice activo. Medir con ResizeObserver habría añadido un
           frame de retraso —la burbuja saldría del sitio viejo— y encima pelea
           con el encogido de la barra, que es un transform y no dispara
           recálculo de tamaño.

           El carril ocupa exactamente el área de contenido de .nav, así que
           "una columna" es aquí el 100% dividido entre el número de elementos,
           sin restar rellenos a mano. */
        .navBubbleTrack {
          position: absolute;
          inset: 5px 6px;
          pointer-events: none;
          z-index: 0;
        }

        .navBubble {
          width: calc(100% / var(--mobile-nav-count));
          height: 100%;
          display: flex;
          align-items: center;
          /* Solo se anima el transform: no provoca recálculo de layout, así que
             el deslizamiento va suelto también en un teléfono modesto. */
          transform: translateX(calc(var(--mobile-nav-active) * 100%));
          transition: transform 340ms cubic-bezier(0.32, 0.72, 0, 1);
          will-change: transform;
        }

        /* La forma va en un hijo: así el que se mueve mide justo una columna y
           el visible puede llevar su propio margen sin ensuciar la cuenta. */
        /* Abraza al icono y su etiqueta, que juntos miden unos 41px dentro de
           una casilla de 62. A toda la altura de la casilla la burbuja se leía
           como un bloque, no como un selector. */
        .navBubbleShape {
          flex: 1;
          min-width: 0;
          height: 46px;
          margin: 0 5px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.10);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
        }

        /* Sin sesión no hay pestaña activa que marcar. */
        .navBubbleTrack[data-hidden="true"] .navBubble {
          opacity: 0;
        }

        @media (prefers-reduced-motion: reduce) {
          .navBubble { transition: none; }
        }

        .item {
          position: relative;
          /* Por encima de la burbuja, que va en z-index 0. */
          z-index: 1;
          height: 62px;
          display: grid;
          place-items: center;
          text-decoration: none;
          -webkit-tap-highlight-color: transparent;
        }

        .item:active {
          transform: scale(0.92);
          transition: transform 0.1s ease;
        }

        .itemInner {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        /* Pequeño y en blanco atenuado: tiene que apoyar al icono, no competir
           con él. Sin cortes de palabra: en un nav de seis huecos, un nombre
           partido en dos líneas descuadra toda la fila. */
        .itemLabel {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: -0.01em;
          line-height: 1;
          color: rgba(255, 255, 255, 0.82);
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .iconPop {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .navBadge {
          position: absolute;
          /* El globo cuelga HACIA ABAJO desde el borde del icono, no hacia
             arriba. Con un top negativo se salía de la caja y rozaba el filo de
             la píldora; a 4px queda dentro y sigue leyéndose como un aviso
             pegado al icono. */
          top: 4px;
          inset-inline-end: -8px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: #a855f7;
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          line-height: 18px;
          text-align: center;
          /* Aro al tono del cristal y semitransparente: uno opaco se recortaba
             como un disco oscuro sobre el fondo translúcido. */
          box-shadow: 0 0 0 2px rgba(22, 22, 28, 0.55);
          pointer-events: none;
          box-sizing: border-box;
        }

        .navDot {
          position: absolute;
          top: -3px;
          inset-inline-end: -3px;
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: #ff3b30;
          box-shadow: 0 0 0 2px rgba(22, 22, 28, 0.55);
        }

        @keyframes navPop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.26); }
          70%  { transform: scale(0.93); }
          100% { transform: scale(1); }
        }

        @keyframes navShake {
          0%   { transform: translateX(0); }
          18%  { transform: translateX(-5px); }
          42%  { transform: translateX(5px); }
          63%  { transform: translateX(-3px); }
          82%  { transform: translateX(3px); }
          100% { transform: translateX(0); }
        }

        .popping {
          animation: navPop 0.38s ease-out both;
        }

        .shaking {
          animation: navShake 0.36s ease-out both;
        }

        @media (max-width: 768px) {
          .wrap {
            display: block;
          }
        }

        /* Con un modal/overlay abierto (marca de useBodyScrollLock), el nav se oculta:
           es negro fijo con z-index alto y, si no, se transparenta bajo los backdrops
           translúcidos simulando una "doble" safe-area inferior. */
        :global(body.vb-modal-open) .wrap {
          display: none;
        }
      `}</style>

      {/* Anclaje para quien necesite saber cuánto ocupa el nav. El reel lo mide
          para apartar sus controles: su alto depende del safe-area del aparato y
          además se encoge al hacer scroll, así que copiarlo como número fijo
          siempre acaba desfasado. */}
      <nav ref={navRef} className="wrap" data-vibra-bottom-nav="" aria-label={t("mobileNavLabel")}>
        {/* Un único `scale` UNIFORME, no uno vertical con otro horizontal que lo
            compense. Antes la barra era un rectángulo a todo lo ancho y aplastarla
            en vertical no se notaba; una píldora sí: los extremos redondeados se
            vuelven óvalos y el borde cambia de grosor. Escalando por igual, encoge
            entera y conserva su forma. */}
        <div
          className="navShell"
          style={{
            transform: `scale(${navScale})`,
            transformOrigin: "bottom center",
            transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            className="nav"
            style={{
              "--mobile-nav-count": nav.length,
              /* Índice de la pestaña activa. Con `pendingHref` la burbuja sale
                 hacia el destino EN CUANTO tocas, sin esperar a que la ruta
                 cambie: es lo que hace que se sienta inmediata. */
              "--mobile-nav-active": Math.max(0, activeIndex),
            } as React.CSSProperties}
          >
            <div
              className="navBubbleTrack"
              data-hidden={activeIndex < 0 ? "true" : undefined}
              aria-hidden="true"
            >
              <div className="navBubble">
                <div className="navBubbleShape" />
              </div>
            </div>

            {nav.map((item, idx) => {
              const isActive = pendingHref !== null
                ? item.href === pendingHref
                : item.active;
              return (
              <Link
                key={item.key}
                href={item.href}
                className="item"
                aria-label={item.label}
                title={item.label}
                aria-current={isActive ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  expandNav();

                  const alreadyHere = pendingHref !== null
                    ? item.href === pendingHref
                    : item.active;

                  // En un perfil —el tuyo o el de otra persona— o dentro de una
                  // comunidad, el avatar sube primero al principio de la
                  // pantalla; solo desde arriba abre el menú. Va antes que el
                  // resto porque su destino (`/menu`) no es la pantalla en la
                  // que estás, así que la comprobación de "raíz" de abajo nunca
                  // lo alcanzaría y se iría al menú de un solo toque.
                  //
                  // Es el atajo que antes daba la flecha morada flotante: al
                  // retirarla, estas dos pantallas se habían quedado sin ninguna
                  // forma de volver arriba que no fuera a dedo.
                  if (
                    item.type === "avatar" &&
                    isScrollableFeed(pathname) &&
                    window.scrollY > 8
                  ) {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    sessionStorage.setItem(`nav:scroll:${pathname}`, "0");
                    return;
                  }

                  if (alreadyHere) {
                    // Estar "en la sección" no siempre es estar en su raíz: el
                    // avatar sigue encendido dentro de tu perfil, mensajes dentro
                    // de un hilo, wallet dentro de una subpestaña. En esos casos
                    // el mismo botón REGRESA a la raíz (el menú, la bandeja, el
                    // índice), que es lo que uno espera al volver a tocarlo.
                    // La sacudida queda solo para cuando ya estás en la raíz y de
                    // verdad no hay a dónde ir.
                    const atRoot = pendingHref !== null
                      ? pendingHref === item.href
                      : pathname === item.href;

                    if (atRoot) {
                      // Estando en la raíz de la sección, el primer toque sube
                      // al principio del feed. La sacudida queda para cuando ya
                      // no hay a dónde ir, que es su significado: "esto es todo".
                      // El umbral evita que un scroll de dos píxeles se coma la
                      // sacudida sin que se note ningún movimiento.
                      if (window.scrollY > 8) {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                        sessionStorage.setItem(`nav:scroll:${pathname}`, "0");
                        return;
                      }
                      setShakingKey(item.key);
                      return;
                    }

                    sessionStorage.setItem(`nav:scroll:${pathname}`, String(window.scrollY));
                    const savedRoot = sessionStorage.getItem(`nav:scroll:${item.href}`);
                    lastScrollYRef.current = savedRoot !== null ? parseInt(savedRoot) : 0;

                    setPoppingKey(item.key);
                    setPendingHref(item.href);
                    // Hacia atrás: entra desde la izquierda.
                    setNavSlideDir("left");
                    router.push(item.href, { scroll: false });
                    return;
                  }

                  // Save current scroll before leaving
                  sessionStorage.setItem(`nav:scroll:${pathname}`, String(window.scrollY));

                  // Pre-seed lastScrollYRef with the destination's saved scroll so
                  // the programmatic scroll restoration doesn't trigger a shrink.
                  const destSaved = sessionStorage.getItem(`nav:scroll:${item.href}`);
                  lastScrollYRef.current = destSaved !== null ? parseInt(destSaved) : 0;

                  setPoppingKey(item.key);
                  setPendingHref(item.href);

                  const currentIdx = pendingHref !== null
                    ? nav.findIndex(n => n.href === pendingHref)
                    : nav.findIndex(n => n.active);
                  const direction = idx >= currentIdx ? "right" : "left";
                  setNavSlideDir(direction);
                  router.push(item.href, { scroll: false });
                }}
              >
                {/* Sin transformación propia. La cáscara ya encoge la barra
                    entera con un scale UNIFORME, así que el scaleX que había
                    aquí se sumaba al de fuera y estrujaba cada icono a lo ancho
                    más que a lo alto. Eso era el desplazamiento al hacer scroll:
                    no se movían de sitio, se deformaban. Es un resto de cuando
                    la barra se aplastaba solo en vertical y había que
                    compensarla. */}
                <div className="itemInner">
                  <span
                    className={
                      poppingKey === item.key ? "iconPop popping" :
                      shakingKey === item.key ? "iconPop shaking" :
                      "iconPop"
                    }
                    onAnimationEnd={() => { setPoppingKey(null); setShakingKey(null); }}
                  >
                    {item.type === "avatar" ? (
                      <ProfileAvatarIcon src={photoURL} active={isActive} />
                    ) : item.iconKey === "home" ? (
                      isActive ? <NavHomeIconFilled /> : <NavHomeIcon />
                    ) : item.iconKey === "reels" ? (
                      isActive ? <NavReelsIconFilled /> : <NavReelsIcon />
                    ) : item.iconKey === "notifications" ? (
                      <>
                        {isActive ? <NavBellIconFilled /> : <NavBellIcon />}
                        {notifAlertCount > 0 ? (
                          <span className="navBadge">
                            {notifAlertCount > 99 ? "99+" : notifAlertCount}
                          </span>
                        ) : null}
                      </>
                    ) : item.iconKey === "messages" ? (
                      <>
                        {isActive ? <NavMessagesIconFilled /> : <NavMessagesIcon />}
                        {unreadMessages > 0 ? (
                          <span className="navBadge">
                            {unreadMessages > 99 ? "99+" : unreadMessages}
                          </span>
                        ) : null}
                      </>
                    ) : item.iconKey === "wallet" ? (
                      isActive ? <NavWalletIconFilled /> : <NavWalletIcon />
                                        ) : (
                      isActive ? <NavGroupsIconFilled /> : <NavGroupsIcon />
                    )}
                  </span>

                  {/* El nombre de la sección. Va DENTRO de itemInner para que
                      se encoja con el nav igual que el icono, y no aparte. El
                      perfil no lo lleva: su avatar ya dice de quién es, y su
                      altura se compensa con un círculo más grande para que no
                      quede desalineado con el resto. */}
                  {item.type !== "avatar" ? (
                    <span className="itemLabel">{item.label}</span>
                  ) : null}
                </div>
              </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
