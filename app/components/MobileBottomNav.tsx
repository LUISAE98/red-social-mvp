"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { db } from "@/lib/firebase";

type MobileNavItem = {
  key: string;
  href: string;
  active: boolean;
  emoji: string;
  label: string;
  type: "emoji" | "avatar";
};

function EmojiIcon({
  emoji,
  active,
}: {
  emoji: string;
  active: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        fontSize: active ? 22 : 20,
        lineHeight: 1,
        transform: active ? "scale(1.03)" : "scale(1)",
        transition: "transform 0.15s ease, opacity 0.2s ease",
        opacity: active ? 1 : 0.78,
      }}
    >
      {emoji}
    </span>
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
          : "1px solid rgba(255,255,255,0.35)",
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
        emoji: "🏠",
        label: "Home",
        type: "emoji",
      },
      {
        key: "groups",
        href: "/groups",
        active: pathname.startsWith("/groups"),
        emoji: "✨",
        label: "Mis comunidades",
        type: "emoji",
      },
    ];

    if (showWallet) {
      items.push({
        key: "wallet",
        href: "/wallet/finanzas",
        active: pathname.startsWith("/wallet"),
        emoji: "📊",
        label: "Wallet",
        type: "emoji",
      });
    }

    items.push({
      key: "profile",
      href: profileHref,
      active: pathname.startsWith("/u/") || pathname.startsWith("/profile"),
      emoji: "👤",
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
    background: rgb(14, 14, 16);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255, 255, 255, 0.12);
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
    color: rgba(255, 255, 255, 0.5);
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
    background: rgba(255, 255, 255, 0.04);
  }

  .indicator {
    position: absolute;
    top: 4px;
    width: 24px;
    height: 3px;
    border-radius: 999px;
    background: transparent;
    transition:
      background 0.2s ease,
      opacity 0.2s ease;
    opacity: 0;
  }

  .itemActive .indicator {
    background: #ffffff;
    opacity: 1;
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
                  <span className="indicator" />
                  <div className="itemInner">
                    {item.type === "avatar" ? (
                      <ProfileAvatarIcon src={photoURL} active={item.active} />
                    ) : (
                      <EmojiIcon emoji={item.emoji} active={item.active} />
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