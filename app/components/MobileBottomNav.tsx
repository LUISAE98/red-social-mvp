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
  | "wallet"
  | "experiences";

type MobileNavItem = {
  key: string;
  href: string;
  active: boolean;
  label: string;
  type: "icon" | "avatar";
  iconKey?: NavIconKey;
};

function NavHomeIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11.2 12 4l8.5 7.2" />
      <path d="M5.8 10.2V20h12.4v-9.8" />
      <path d="M9.5 20v-5.8h5V20" />
    </svg>
  );
}

function NavHomeIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" d="M3.5 11.2 12 4l8.5 7.2" />
      <path fill="white" d="M5.8 10.2V20h12.4v-9.8" />
      <path fill="#000000" d="M9.5 20v-5.8h5V20" />
    </svg>
  );
}

// Historias: un marco vertical con el triángulo de reproducir. Vertical, para
// que se lea como video a pantalla completa y no como una galería.
function NavReelsIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="3.2" />
      <path d="M10.6 8.9v6.2l5-3.1z" />
    </svg>
  );
}

function NavReelsIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="3.2" fill="white" />
      <path d="M10.6 8.9v6.2l5-3.1z" fill="#000000" stroke="#000000" />
    </svg>
  );
}

function NavWalletIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
      <rect x="3" y="7" width="18" height="12" rx="2.5" />
      <path d="M16 12.5h3" />
    </svg>
  );
}

function NavWalletIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" stroke="white" d="M5 5h12a2 2 0 0 1 2 2H3a2 2 0 0 1 2-2Z" />
      <rect x="3" y="7" width="18" height="12" rx="2.5" fill="white" stroke="white" />
      <path fill="#000000" stroke="none" d="M16.4 11.4a2.3 2.3 0 0 0 0 4.6H21v-4.6Z" />
    </svg>
  );
}

function NavBellIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8" />
      <path d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function NavBellIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" d="M6 8a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8Z" />
      <path d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function NavGroupsIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6.5" r="3.2" />
      <circle cx="6.5" cy="16" r="3.2" />
      <circle cx="17.5" cy="16" r="3.2" />
      <path d="M9.4 8.8L8.8 13" strokeWidth={1.5} />
      <path d="M14.6 8.8L15.2 13" strokeWidth={1.5} />
      <path d="M9.7 16H14.3" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * Mensajes: mismo globo de conversación que identifica al DM en el resto del
 * producto, redibujado con el trazo de 30px de este nav.
 */
function NavMessagesIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 12.2C20.5 16.1 16.7 19.2 12 19.2C11 19.2 10.1 19.1 9.2 18.9L4.6 20.4L5.7 16.6C4.4 15.4 3.5 13.9 3.5 12.2C3.5 8.3 7.3 5.2 12 5.2C16.7 5.2 20.5 8.3 20.5 12.2Z" />
    </svg>
  );
}

function NavMessagesIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path
        d="M20.5 12.2C20.5 16.1 16.7 19.2 12 19.2C11 19.2 10.1 19.1 9.2 18.9L4.6 20.4L5.7 16.6C4.4 15.4 3.5 13.9 3.5 12.2C3.5 8.3 7.3 5.2 12 5.2C16.7 5.2 20.5 8.3 20.5 12.2Z"
        fill="white"
      />
    </svg>
  );
}

function NavGroupsIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6.5" r="3.2" fill="white" />
      <circle cx="6.5" cy="16" r="3.2" fill="white" />
      <circle cx="17.5" cy="16" r="3.2" fill="white" />
      <path d="M9.4 8.8L8.8 13" strokeWidth={1.5} />
      <path d="M14.6 8.8L15.2 13" strokeWidth={1.5} />
      <path d="M9.7 16H14.3" strokeWidth={1.5} />
    </svg>
  );
}

function NavStarIcon() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2l2.7 5.47 6.03.88-4.36 4.25 1.03 6.0L12 17.9l-5.4 2.84 1.03-6.0L3.27 9.55l6.03-.88z" />
    </svg>
  );
}

function NavStarIconFilled() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" d="M12 3.2l2.7 5.47 6.03.88-4.36 4.25 1.03 6.0L12 17.9l-5.4 2.84 1.03-6.0L3.27 9.55l6.03-.88z" />
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
  const size = 32;

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

export default function MobileBottomNav({
  showWallet = false,
  showExperiences = false,
  experiencesBadge = false,
}: {
  showWallet?: boolean;
  /** Estrella "Mis experiencias": solo para quien compró alguna experiencia. */
  showExperiences?: boolean;
  /** Punto de notificación en la estrella: hay algo nuevo sin ver. */
  experiencesBadge?: boolean;
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
    idleTimerRef.current = setTimeout(() => setNavScale(0.75), 5000);
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
        setNavScale(0.75);
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

    // Experiencias (compras del usuario): estrella junto a notificaciones.
    // Solo aparece si el usuario ya compró alguna experiencia.
    if (showExperiences) {
      items.push({
        key: "experiences",
        href: "/experiencias",
        active: pathname.startsWith("/experiencias"),
        label: t("tabExperiences"),
        type: "icon",
        iconKey: "experiences",
      });
    }

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
  }, [pathname, menuHref, handle, showWallet, showExperiences]);

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
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          pointer-events: none;
          view-transition-name: mobile-nav;
        }

        .navShell {
          width: 100%;
          pointer-events: auto;
          background: #000000;
        }

        .nav {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(var(--mobile-nav-count), minmax(0, 1fr));
          align-items: center;
          /* Safe-area inferior constante solo logueado (var = 20px con body.vb-authed, 0 sin sesión). */
          padding: 8px 6px calc(8px + var(--vb-safe-bottom, 0px));
          background: #000000;
          box-sizing: border-box;
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
        }

        .item {
          position: relative;
          height: 54px;
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
          display: grid;
          place-items: center;
        }

        .iconPop {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .navBadge {
          position: absolute;
          top: -5px;
          inset-inline-end: -8px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 999px;
          background: #ff3b30;
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          line-height: 16px;
          text-align: center;
          box-shadow: 0 0 0 2px #000000;
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
          box-shadow: 0 0 0 2px #000000;
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
        <div
          className="navShell"
          style={{
            transform: `scaleY(${navScale})`,
            transformOrigin: "bottom center",
            transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            className="nav"
            style={{
              "--mobile-nav-count": nav.length,
              transform: `translateZ(0) scaleX(${Math.sqrt(navScale)})`,
              transformOrigin: "center",
              transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
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
                <div
                  className="itemInner"
                  style={{
                    transform: `scaleX(${Math.sqrt(navScale)})`,
                    transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
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
                    ) : item.iconKey === "experiences" ? (
                      <>
                        {isActive ? <NavStarIconFilled /> : <NavStarIcon />}
                        {experiencesBadge ? <span className="navDot" aria-hidden="true" /> : null}
                      </>
                    ) : (
                      isActive ? <NavGroupsIconFilled /> : <NavGroupsIcon />
                    )}
                  </span>
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
