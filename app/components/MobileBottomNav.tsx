"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { db } from "@/lib/firebase";

type NavIconKey = "home" | "groups" | "wallet";

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
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11.2 12 4l8.5 7.2" />
      <path d="M5.8 10.2V20h12.4v-9.8" />
      <path d="M9.5 20v-5.8h5V20" />
    </svg>
  );
}

function NavWalletIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Outer wallet body */}
      <path d="M4 9C4 7.3 5.3 6 7 6H17C18.7 6 20 7.3 20 9V16C20 17.7 18.7 19 17 19H7C5.3 19 4 17.7 4 16V9Z" />
      {/* Top separator line */}
      <path d="M4 11.5H20" />
      {/* Bill lines left side */}
      <path d="M6.5 14.5H11" strokeWidth={1.6} />
      <path d="M6.5 16.5H10" strokeWidth={1.6} />
      {/* Coin pocket right side */}
      <circle cx="15.5" cy="15.2" r="2.2" />
    </svg>
  );
}

function NavGroupsIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Three circles in triangle arrangement suggesting a group/community */}
      <circle cx="12" cy="6.5" r="3.2" />
      <circle cx="6.5" cy="16" r="3.2" />
      <circle cx="17.5" cy="16" r="3.2" />
      {/* Connecting lines between nodes */}
      <path d="M9.4 8.8L8.8 13" strokeWidth={1.5} />
      <path d="M14.6 8.8L15.2 13" strokeWidth={1.5} />
      <path d="M9.7 16H14.3" strokeWidth={1.5} />
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
  const size = 28;

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
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          style={{
            width: "100%",
            height: "100%",
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
}: {
  showWallet?: boolean;
}) {
  const pathname = usePathname();
  const { user } = useAuth();

  const [handle, setHandle] = useState<string | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setHandle(null);
      setPhotoURL(null);
      return;
    }

    const uid = user.uid;

    async function loadProfileData() {
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

  const profileHref = handle ? `/u/${handle}` : "/login";

  const nav = useMemo(() => {
    const items: MobileNavItem[] = [
      {
        key: "home",
        href: "/",
        active: pathname === "/" || pathname === "/home" || pathname.startsWith("/feed"),
        label: "Home",
        type: "icon",
        iconKey: "home",
      },
      {
        key: "groups",
        href: "/groups",
        active: pathname.startsWith("/groups"),
        label: "Mis comunidades",
        type: "icon",
        iconKey: "groups",
      },
    ];

    if (showWallet) {
      items.push({
        key: "wallet",
        href: "/wallet/finanzas",
        active: pathname.startsWith("/wallet"),
        label: "Wallet",
        type: "icon",
        iconKey: "wallet",
      });
    }

    items.push({
      key: "profile",
      href: profileHref,
      active: pathname.startsWith("/u/") || pathname.startsWith("/profile"),
      label: "Mi perfil",
      type: "avatar",
    });

    return items;
  }, [pathname, profileHref, showWallet]);

  return (
    <>
      <style jsx>{`
        .wrap {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 9999;
          display: none;
          width: 100%;
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          pointer-events: none;
          background: #000000;
          /* Safe area fill: the wrap's own background covers the inset on all OS */
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }

        .navShell {
          width: 100%;
          pointer-events: auto;
        }

        .nav {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(var(--mobile-nav-count), minmax(0, 1fr));
          align-items: center;
          padding: 8px 6px 8px;
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

        .selCircle {
          position: absolute;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.13);
          pointer-events: none;
        }

        .itemInner {
          position: relative;
          z-index: 1;
          display: grid;
          place-items: center;
        }

        @media (max-width: 768px) {
          .wrap {
            display: block;
          }
        }
      `}</style>

      <nav className="wrap" aria-label="Navegación móvil inferior">
        <div className="navShell">
          <div
            className="nav"
            style={{ "--mobile-nav-count": nav.length } as React.CSSProperties}
          >
            {nav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="item"
                aria-label={item.label}
                title={item.label}
                aria-current={item.active ? "page" : undefined}
              >
                {item.active && <span className="selCircle" />}
                <div className="itemInner">
                  {item.type === "avatar" ? (
                    <ProfileAvatarIcon src={photoURL} active={item.active} />
                  ) : item.iconKey === "home" ? (
                    <NavHomeIcon />
                  ) : item.iconKey === "wallet" ? (
                    <NavWalletIcon />
                  ) : (
                    <NavGroupsIcon />
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}
