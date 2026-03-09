"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { db } from "@/lib/firebase";

function IconHome({ active }: { active: boolean }) {
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M3 10.5L12 3L21 10.5V20C21 20.5523 20.5523 21 20 21H15V14H9V21H4C3.44772 21 3 20.5523 3 20V10.5Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGroups({ active }: { active: boolean }) {
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <circle cx="10" cy="8" r="4" stroke="currentColor" strokeWidth="2.1" />
      <path
        d="M4 20C4.8 16.8 7.4 15 12 15C16.6 15 19.2 16.8 20 20"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconProfile({ active }: { active: boolean }) {
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2.1" />
      <path
        d="M4 20C4.8 16.8 7.4 15 12 15C16.6 15 19.2 16.8 20 20"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
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
      key: "profile",
      href: profileHref,
      active: pathname.startsWith("/u/") || pathname.startsWith("/profile"),
      icon: IconProfile,
      label: "Perfil",
    },
    {
      key: "groups",
      href: "/groups",
      active: pathname.startsWith("/groups"),
      icon: IconGroups,
      label: "Grupos",
    },
    {
      key: "home",
      href: "/",
      active: pathname === "/" || pathname === "/home" || pathname.startsWith("/feed"),
      icon: IconHome,
      label: "Home",
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
          justify-content: center;
          pointer-events: none;
        }

        .nav {
          width: min(100%, 680px);
          margin: 0 auto;
          pointer-events: auto;
          background: rgba(8, 8, 8, 0.97);
          backdrop-filter: blur(16px);
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.3);
          padding: 12px 22px calc(18px + env(safe-area-inset-bottom));
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: center;
        }

        .item {
          position: relative;
          min-width: 0;
          min-height: 58px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          color: rgba(255, 255, 255, 0.58);
          transition:
            color 0.22s ease,
            transform 0.22s ease,
            opacity 0.22s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .item:active {
          transform: scale(0.96);
        }

        .itemInner {
          position: relative;
          width: 52px;
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          transition:
            transform 0.22s ease,
            background 0.22s ease,
            box-shadow 0.22s ease;
        }

        .itemActive {
          color: #fff;
        }

        .itemActive .itemInner {
          transform: translateY(-3px);
          background: rgba(255, 255, 255, 0.06);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
        }

        .indicator {
          position: absolute;
          top: -7px;
          left: 50%;
          transform: translateX(-50%);
          width: 18px;
          height: 3px;
          border-radius: 999px;
          background: #fff;
          opacity: 0;
          transition:
            opacity 0.22s ease,
            transform 0.22s ease;
        }

        .itemActive .indicator {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        @media (max-width: 768px) {
          .wrap {
            display: flex;
          }
        }
      `}</style>

      <nav className="wrap" aria-label="Navegación móvil inferior">
        <div className="nav">
          {nav.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={`item ${item.active ? "itemActive" : ""}`}
                aria-label={item.label}
                title={item.label}
              >
                <div className="itemInner">
                  <span className="indicator" />
                  <Icon active={item.active} />
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}