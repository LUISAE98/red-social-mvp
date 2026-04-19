"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { db } from "@/lib/firebase";

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

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setHandle(null);
      return;
    }

    const uid = user.uid;

    async function loadHandle() {
      try {
        const snap = await getDoc(doc(db, "users", uid));

        if (snap.exists()) {
          const data = snap.data() as { handle?: string };
          setHandle(data.handle ?? null);
        } else {
          setHandle(null);
        }
      } catch {
        setHandle(null);
      }
    }

    loadHandle();
  }, [user]);

  const profileHref = handle ? `/u/${handle}` : "/login";

  const nav = [
    {
      key: "home",
      href: "/",
      active:
        pathname === "/" ||
        pathname === "/home" ||
        pathname.startsWith("/feed"),
      emoji: "🏠",
      label: "Home",
    },
    {
      key: "groups",
      href: "/groups",
      active: pathname.startsWith("/groups"),
      emoji: "🫂",
      label: "Mis comunidades",
    },
    {
      key: "profile",
      href: profileHref,
      active: pathname.startsWith("/u/") || pathname.startsWith("/profile"),
      emoji: "👤",
      label: "Mi perfil",
    },
  ];

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
        }

        .navShell {
          width: 100%;
        }

        .nav {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: center;
          padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
          background: rgba(20, 20, 22, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255, 255, 255, 0.12);
        }

        .item {
          position: relative;
          height: 52px;
          display: grid;
          place-items: center;
          text-decoration: none;
          color: rgba(255, 255, 255, 0.5);
          transition: color 0.2s ease, transform 0.15s ease,
            background 0.2s ease;
          border-radius: 16px;
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
          transition: background 0.2s ease, opacity 0.2s ease;
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
          <div className="nav">
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
                    <EmojiIcon emoji={item.emoji} active={item.active} />
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