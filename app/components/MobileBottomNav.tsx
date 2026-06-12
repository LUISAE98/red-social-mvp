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

function NavHomeIcon({ active }: { active: boolean }) {
  const stroke = active ? "#ffffff" : "rgba(255,255,255,0.45)";
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11.2 12 4l8.5 7.2" />
      <path d="M5.8 10.2V20h12.4v-9.8" />
      <path d="M9.5 20v-5.8h5V20" />
    </svg>
  );
}

function NavWalletIcon({ active }: { active: boolean }) {
  const stroke = active ? "#ffffff" : "rgba(255,255,255,0.45)";
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 11.5h19" />
      <rect x="14" y="13.5" width="7.5" height="4" rx="1.5" />
    </svg>
  );
}

function NavGroupsIcon({ active }: { active: boolean }) {
  const stroke = active ? "#ffffff" : "rgba(255,255,255,0.45)";
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6.8" r="2.6" />
      <circle cx="6" cy="9.8" r="2" />
      <circle cx="18" cy="9.8" r="2" />
      <path d="M7.5 20c.6-3.4 2.4-5.2 4.5-5.2s3.9 1.8 4.5 5.2" />
      <path d="M2.5 18c.4-2.6 1.8-4.2 3.5-4.2" />
      <path d="M21.5 18c-.4-2.6-1.8-4.2-3.5-4.2" />
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
  const size = active ? 29 : 27;

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
          ? "2px solid rgba(255,255,255,0.95)"
          : "1.5px solid rgba(255,255,255,0.35)",
        transform: active ? "scale(1.03)" : "scale(1)",
        transition:
          "transform 0.15s ease, opacity 0.2s ease, border-color 0.2s ease",
        opacity: active ? 1 : 0.84,
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
        <span
          style={{
            fontSize: 14,
            lineHeight: 1,
            fontWeight: 800,
            color: "#fff",
          }}
        >
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
          setPhotoURL(
            data.photoURL ??
              data.avatarUrl ??
              data.avatarURL ??
              null
          );
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
        active:
          pathname === "/" ||
          pathname === "/home" ||
          pathname.startsWith("/feed"),
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
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
    background: #000000;
    box-sizing: border-box;
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
  }

  .item {
    position: relative;
    height: 52px;
    display: grid;
    place-items: center;
    text-decoration: none;
    color: rgba(255, 255, 255, 0.45);
    transition:
      color 0.2s ease,
      transform 0.15s ease,
      background 0.2s ease;
    border-radius: 16px;
    -webkit-tap-highlight-color: transparent;
  }

  .item:active {
    transform: scale(0.95);
  }

  .itemActive {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.05);
  }

  .itemInner {
    display: grid;
    justify-items: center;
    gap: 4px;
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
            style={
              {
                "--mobile-nav-count": nav.length,
              } as React.CSSProperties
            }
          >
            {nav.map((item) => {
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`item ${item.active ? "itemActive" : ""}`}
                  aria-label={item.label}
                  title={item.label}
                >
                  <div className="itemInner">
                    {item.type === "avatar" ? (
                      <ProfileAvatarIcon src={photoURL} active={item.active} />
                    ) : item.iconKey === "home" ? (
                      <NavHomeIcon active={item.active} />
                    ) : item.iconKey === "wallet" ? (
                      <NavWalletIcon active={item.active} />
                    ) : (
                      <NavGroupsIcon active={item.active} />
                    )}
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
