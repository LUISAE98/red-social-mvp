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

/**
 * Casa: UN SOLO trazado cerrado.
 *
 * Empieza en la cumbrera, baja por el alero derecho, cae por la pared, y al
 * llegar al suelo se mete hacia arriba para dejar el HUECO de la puerta antes
 * de seguir hasta la pared izquierda y cerrar. La puerta no se dibuja: es la
 * muesca que el propio contorno deja al pasar.
 *
 * Que sea un único trazado es lo que hace que las dos versiones sean el MISMO
 * icono: la de contorno lo traza y la rellena lo pinta. Antes eran dibujos
 * distintos —tres trazos sueltos por un lado, una silueta recortada con una
 * máscara por el otro— y no acababan de coincidir.
 *
 * Medidas y esquinas NO se escribieron a mano: salen de un generador que
 * redondea cada vértice entrando y saliendo a una distancia fija por cada lado
 * y uniendo los dos puntos con una curva cuyo control es el propio vértice.
 * Dibuja 18.4 x 17.6 con el trazo incluido, frente a los 18.6 del cuadro de
 * reels: la misma caja a la vista.
 */
const HOME_PATH =
  "M10.68 5.18Q12 4.1 13.32 5.18L19.06 9.89Q20.3 10.9 20.3 12.5L20.3 18.3Q20.3 19.9 18.7 19.9L15.2 19.9Q14.1 19.9 14.1 18.8L14.1 16.3Q14.1 15.2 13 15.2L11 15.2Q9.9 15.2 9.9 16.3L9.9 18.8Q9.9 19.9 8.8 19.9L5.3 19.9Q3.7 19.9 3.7 18.3L3.7 12.5Q3.7 10.9 4.94 9.89Z";

function NavHomeIcon() {
  return (
    <svg {...NAV_ICON}>
      <path d={HOME_PATH} />
    </svg>
  );
}

function NavHomeIconFilled() {
  return (
    <svg {...NAV_ICON}>
      {/* El mismo trazado, relleno. Sin máscara: el hueco de la puerta ya
          está en el propio contorno, así que el relleno no llega ahí. */}
      <path d={HOME_PATH} fill="white" stroke="white" />
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
const NAV_SHRUNK_SCALE = 0.93;

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
  /**
   * Qué icono está encendido en degradado.
   *
   * Estado aparte de `poppingKey` a propósito. El rebote dura 380ms y al
   * acabar limpia su clave; si el encendido colgara de ella, se desmontaría a
   * los 380ms y su desvanecido de 900ms se cortaría en seco a media caída. Ese
   * corte era justo lo que se veía como "el color desaparece de golpe".
   */
  const [glowKey, setGlowKey] = useState<string | null>(null);
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
          /* Píldora entera: el radio supera la mitad del alto, así que los
             extremos salen semicirculares pase lo que pase con el alto. */
          border-radius: 999px;
          /* CRISTAL ÓPTICO OSCURO.
             ======================
             A primera vista, una cápsula negra. Solo al pasar una foto o un
             video por detrás se descubre que hay algo: sus colores tiñen el
             cristal en manchas suaves. Ese es todo el efecto, y es deliberado
             que no se note más.

             Dos piezas, y solo dos: la BASE casi negra, y el FILTRO de abajo
             que es lo único que trae algo de lo que pasa por detrás. Todo lo
             que se pinte ENCIMA de la base la agrisa. */
          /* NEGRO, no gris. Aquí hubo tres degradados de blanco encima —una
             cúpula de luz, un contraluz y una franja— para simular volumen. El
             efecto secundario era justo el que no se quería: superponer blanco
             sobre negro da GRIS, y la cápsula se alejaba del negro cuanto más
             se subían. Se fueron los tres. El volumen no se pinta: tiene que
             venir del fondo, y eso es lo que hace el filtro de abajo. */
          background: rgba(6, 6, 8, 0.92);
          /* Borde casi invisible. Su trabajo ya no es dibujar el canto —de eso
             se encargan las luces interiores de abajo— sino evitar que sobre un
             fondo muy claro la cápsula se quede sin límite. Al 4% cumple sin
             leerse como una línea. */
          border: 1px solid rgba(255, 255, 255, 0.04);
          /* VOLUMEN SIN CANTO GRUESO.
             =========================
             El grosor que se veía no era el borde: eran TRES líneas duras
             sumadas —el borde de 1px más dos sombras interiores de 1.5px sin
             difuminar—, casi 3px de canto pintado.

             Ahora esas dos interiores van DIFUMINADAS y con desplazamiento
             negativo, así que no dibujan una línea sino una transición de luz
             de un par de píxeles. El ojo lee curvatura igual —una superficie
             curva no tiene el canto marcado, tiene un degradado hacia él— pero
             sin ninguna arista.

             El volumen que se pierde al quitar las líneas se recupera fuera:
             las cuatro sombras exteriores suben un punto. Ahí no hay riesgo de
             engrosar nada, porque caen sobre el contenido, no sobre la cápsula. */
          box-shadow:
            inset 0 2px 3px -2px rgba(255, 255, 255, 0.38),
            inset 0 -2px 3px -2px rgba(0, 0, 0, 0.80),
            inset 0 -16px 26px -16px rgba(0, 0, 0, 0.85),
            inset 0 14px 24px -18px rgba(255, 255, 255, 0.12),
            0 1px 2px rgba(0, 0, 0, 0.45),
            0 6px 14px rgba(0, 0, 0, 0.44),
            0 18px 36px rgba(0, 0, 0, 0.56),
            0 38px 76px rgba(0, 0, 0, 0.66);
          /* El efecto óptico, subido de intensidad.

             · blur(72px): el fondo llega en manchas grandes, sin una sola
               forma reconocible. Es desenfoque de material, no de suavizado.
             · saturate(260%): con la base al 80% solo pasa una quinta parte de
               lo de detrás, así que el color hay que exagerarlo para que se
               note al atravesarla. Es LO QUE MÁS SE NOTA de todo.
             · contrast(120%) y brightness(120%): separan las manchas y las
               levantan lo justo para que atraviesen una base ya bastante
               cerrada.

             🚨 DEFORMAR el fondo, como la lupa de iOS, NO se puede desde CSS en
             iPhone. Se haría con un filtro SVG de desplazamiento dentro de
             backdrop-filter, y Safari no admite url() ahí — solo Chrome. Lo que
             hay aquí es desenfoque y color, que es todo lo que WebKit ofrece. */
          backdrop-filter: blur(40px) saturate(150%);
          -webkit-backdrop-filter: blur(40px) saturate(150%);
          /* SIN overflow:hidden. Los globos de aviso se dibujan fuera de su
             icono (top:-5px, inset-inline-end:-8px) y en el primer y el ultimo
             elemento caerian justo sobre el borde: recortarlos los partiria por
             la mitad. Los hijos no tienen fondo, asi que no hay nada que la
             curva del borde necesite recortar. */
        }

        /* Sin backdrop-filter no hay nada que difuminar, y una base al 80% se
           vería como una barra medio transparente con el contenido crudo detrás
           —peor que no intentarlo—. Ahí la cápsula se cierra y se comporta como
           lo que aparenta: negra. */
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .navShell {
            background: rgba(6, 6, 8, 0.96);
          }
        }

        .nav {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(var(--mobile-nav-count), minmax(0, 1fr));
          align-items: center;
          /* Sin fondo propio: el de la píldora es el que se ve. El safe-area ya
             lo reserva el contenedor. */
          padding: 7px 6px;
          background: transparent;
          box-sizing: border-box;
          /* Ancla de la burbuja, que va en posición absoluta dentro. */
          position: relative;
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
        }


        .item {
          position: relative;
          z-index: 1;
          height: 74px;
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

        /* ENCENDIDO al elegir sección.
           ============================
           Al tocar, sobre la casilla se pinta una copia de TODO lo blanco —el
           relleno del icono, su contorno y la etiqueta— en degradado de marca,
           y esa copia se desvanece despacio. Arranca en color y termina
           completamente en blanco.

           Va como copia superpuesta y no recoloreando lo de debajo porque un
           degradado no se puede animar hacia un color plano: ni en un fill de
           SVG ni en el color de un texto. Con dos capas lo que se anima es la
           opacidad de la de arriba, que además es lo más barato que hay.

           La copia es aria-hidden y no recibe eventos: para un lector de
           pantalla la casilla sigue teniendo un icono y una etiqueta. */
        .vibraFlash {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          /* El mismo hueco que .itemInner: la copia tiene que caer EXACTAMENTE
             encima del original o se vería doble. */
          gap: 2px;
          pointer-events: none;
          animation: vbIconVibra 900ms cubic-bezier(0.33, 0, 0.67, 1) forwards;
        }

        /* 🚨 HAY QUE LISTAR LOS COLORES UNO A UNO. No basta con poner el
           degradado en el <svg> y confiar en que herede.

           Un atributo de pintura escrito en el propio elemento —stroke="white"
           en un <path>— es una declaración SUYA, y cualquier declaración propia
           gana a un valor heredado del padre. Con la regla solo en el <svg>, el
           relleno sí se teñía pero el CONTORNO seguía blanco: se veía el icono
           de color con su silueta blanca alrededor. El único que salía bien era
           reels, y solo porque es el único cuyo dibujo no lleva stroke propio.

           De ahí que se ataquen por selector de atributo, tanto el trazo como el
           relleno, y en las tres formas de escribir blanco que hay en el
           archivo. Si algún icono nuevo usa otra —rgb(), currentColor—, hay que
           añadirla aquí o ese icono se quedará con la silueta blanca. */
        .vibraFlash :global(svg),
        .vibraFlash :global(svg [stroke="white"]),
        .vibraFlash :global(svg [stroke="#fff"]),
        .vibraFlash :global(svg [stroke="#ffffff"]) {
          stroke: url(#vbNavGradient);
        }

        .vibraFlash :global(svg [fill="white"]),
        .vibraFlash :global(svg [fill="#fff"]),
        .vibraFlash :global(svg [fill="#ffffff"]) {
          fill: url(#vbNavGradient);
        }

        /* 🚨 Las MÁSCARAS se quedan en blanco y negro. Dos iconos —inicio y
           wallet— recortan su detalle interior con una máscara: su rectángulo
           va en blanco y su trazo en negro, y esos dos colores no son decoración,
           son los que deciden qué se dibuja y qué no. Si el degradado entrara
           ahí, la puerta de la casa dejaría de ser un hueco.

           OJO CON LA ESPECIFICIDAD. El rectángulo de la máscara lleva
           fill="#fff", así que lo caza la regla del degradado de arriba, que
           vale (0,2,1). Un selector de solo elementos llega a (0,1,3) y
           PERDERÍA pese a ir después. Por eso aquí se repite el selector de
           atributo: sube a (0,2,2) y gana. */
        .vibraFlash :global(svg mask [fill="#fff"]),
        .vibraFlash :global(svg mask [fill="white"]) {
          fill: #fff;
        }

        /* La etiqueta. Un texto no admite un degradado como color, así que se
           pinta el degradado de fondo y se recorta con la forma de las letras. */
        .vibraFlash .itemLabel {
          background: linear-gradient(135deg, #ec4899 0%, #a855f7 55%, #7c3aed 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }

        @keyframes vbIconVibra {
          from { opacity: 1; }
          to   { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .vibraFlash { animation-duration: 1ms; }
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
        {/* El degradado de marca que enciende el icono al elegir sección. Vive
            aquí, una sola vez, y los iconos lo referencian por su id: un
            degradado SVG no se puede declarar desde CSS. El svg no ocupa ni
            pinta nada, solo transporta la definición. */}
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
          <defs>
            <linearGradient id="vbNavGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ec4899" />
              <stop offset="55%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
          </defs>
        </svg>

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
            } as React.CSSProperties}
          >
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
                    setGlowKey(item.key);
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
                  setGlowKey(item.key);
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
                  {(() => {
                    /* El icono, SOLO el icono. Antes se resolvía dentro del
                       mismo ternario que los globos de aviso, y para poder
                       superponerle la copia en degradado hace falta tenerlo
                       suelto: duplicar aquello habría duplicado también el
                       globo. */
                    const icono =
                      item.type === "avatar" ? (
                        <ProfileAvatarIcon src={photoURL} active={isActive} />
                      ) : item.iconKey === "home" ? (
                        isActive ? <NavHomeIconFilled /> : <NavHomeIcon />
                      ) : item.iconKey === "reels" ? (
                        isActive ? <NavReelsIconFilled /> : <NavReelsIcon />
                      ) : item.iconKey === "notifications" ? (
                        isActive ? <NavBellIconFilled /> : <NavBellIcon />
                      ) : item.iconKey === "messages" ? (
                        isActive ? <NavMessagesIconFilled /> : <NavMessagesIcon />
                      ) : item.iconKey === "wallet" ? (
                        isActive ? <NavWalletIconFilled /> : <NavWalletIcon />
                      ) : (
                        isActive ? <NavGroupsIconFilled /> : <NavGroupsIcon />
                      );

                    const globo =
                      item.iconKey === "notifications" && notifAlertCount > 0 ? (
                        <span className="navBadge">
                          {notifAlertCount > 99 ? "99+" : notifAlertCount}
                        </span>
                      ) : item.iconKey === "messages" && unreadMessages > 0 ? (
                        <span className="navBadge">
                          {unreadMessages > 99 ? "99+" : unreadMessages}
                        </span>
                      ) : null;

                    /* El encendido solo en los iconos dibujados. El avatar es
                       una foto: teñirla de morado no se leería como un
                       encendido, se leería como un fallo de color. */
                    const enciende =
                      glowKey === item.key && item.type !== "avatar";

                    /* El nombre de la sección. Va DENTRO de itemInner para que
                       se encoja con el nav igual que el icono, y no aparte. El
                       perfil no lo lleva: su avatar ya dice de quién es, y su
                       altura se compensa con un círculo más grande para que no
                       quede desalineado con el resto. */
                    const etiqueta =
                      item.type !== "avatar" ? (
                        <span className="itemLabel">{item.label}</span>
                      ) : null;

                    return (
                      <>
                        <span
                          className={
                            poppingKey === item.key ? "iconPop popping" :
                            shakingKey === item.key ? "iconPop shaking" :
                            "iconPop"
                          }
                          onAnimationEnd={() => { setPoppingKey(null); setShakingKey(null); }}
                        >
                          {icono}
                          {globo}
                        </span>

                        {etiqueta}

                        {/* La copia en degradado, encima de las dos capas de
                            arriba. Sin el globo de aviso: es rojo por decreto y
                            teñirlo lo sacaría de su código de color. */}
                        {enciende ? (
                          <span
                            className="vibraFlash"
                            aria-hidden="true"
                            /* Solo la animación PROPIA de esta capa la retira.
                               Sin la comprobación, el rebote del icono de dentro
                               burbujea hasta aquí y apagaría el color a los
                               380ms, que es cuando termina el rebote. */
                            onAnimationEnd={(e) => {
                              if (e.target === e.currentTarget) setGlowKey(null);
                            }}
                          >
                            {/* La copia lleva el MISMO rebote que el original.
                                Sin él, el icono de debajo crece hasta 1.26 y la
                                copia se queda en su tamaño: por los bordes
                                asomaba el blanco y el icono nunca llegaba a
                                verse entero de color. */}
                            <span
                              className={
                                poppingKey === item.key ? "iconPop popping" : "iconPop"
                              }
                            >
                              {icono}
                            </span>
                            {etiqueta}
                          </span>
                        ) : null}
                      </>
                    );
                  })()}
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
