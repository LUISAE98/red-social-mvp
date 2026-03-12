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
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M12 3.2L20 9.3V20.2C20 20.64 19.64 21 19.2 21H14.8C14.36 21 14 20.64 14 20.2V15.4C14 14.96 13.64 14.6 13.2 14.6H10.8C10.36 14.6 10 14.96 10 15.4V20.2C10 20.64 9.64 21 9.2 21H4.8C4.36 21 4 20.64 4 20.2V9.3L12 3.2Z"
        stroke="currentColor"
        strokeWidth={active ? "1.65" : "1.9"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGroups({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M8 12C9.65685 12 11 10.6569 11 9C11 7.34315 9.65685 6 8 6C6.34315 6 5 7.34315 5 9C5 10.6569 6.34315 12 8 12Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
      />
      <path
        d="M16 11C17.3807 11 18.5 9.88071 18.5 8.5C18.5 7.11929 17.3807 6 16 6C14.6193 6 13.5 7.11929 13.5 8.5C13.5 9.88071 14.6193 11 16 11Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
      />
      <path
        d="M3.8 17.8C4.65 15.85 6.23 14.8 8 14.8C9.77 14.8 11.35 15.85 12.2 17.8"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
      <path
        d="M12.8 17.2C13.45 15.7 14.72 14.9 16.15 14.9C17.58 14.9 18.85 15.7 19.5 17.2"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconProfile({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <circle
        cx="12"
        cy="8"
        r="4"
        stroke="currentColor"
        strokeWidth={active ? "1.65" : "1.9"}
      />
      <path
        d="M4 20C4.8 16.8 7.4 15 12 15C16.6 15 19.2 16.8 20 20"
        stroke="currentColor"
        strokeWidth={active ? "1.65" : "1.9"}
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
      key: "home",
      href: "/",
      active:
        pathname === "/" ||
        pathname === "/home" ||
        pathname.startsWith("/feed"),
      icon: IconHome,
      label: "Home",
    },
    {
      key: "groups",
      href: "/groups",
      active: pathname.startsWith("/groups"),
      icon: IconGroups,
      label: "Grupos",
    },
    {
      key: "profile",
      href: profileHref,
      active: pathname.startsWith("/u/") || pathname.startsWith("/profile"),
      icon: IconProfile,
      label: "Perfil",
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
          padding: 0 10px calc(10px + env(safe-area-inset-bottom));
        }

        .navShell {
          width: min(100%, 680px);
          pointer-events: auto;
        }

        .nav {
          width: 100%;
          background: rgba(8, 8, 8, 0.96);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.28);
          border-radius: 24px;
          padding: 6px 8px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: center;
          gap: 6px;
        }

        .item {
          min-width: 0;
          height: 48px;
          display: grid;
          place-items: center;
          text-decoration: none;
          color: rgba(255, 255, 255, 0.46);
          border-radius: 14px;
          transition:
            color 0.18s ease,
            transform 0.18s ease,
            opacity 0.18s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .item:active {
          transform: scale(0.97);
        }

        .itemActive {
          color: #fff;
        }

        .itemInner {
          display: grid;
          justify-items: center;
          gap: 6px;
        }

        .indicator {
          width: 18px;
          height: 3px;
          border-radius: 999px;
          background: transparent;
          transition: background 0.18s ease, opacity 0.18s ease;
          opacity: 0;
        }

        .itemActive .indicator {
          background: #fff;
          opacity: 1;
        }

        @media (max-width: 768px) {
          .wrap {
            display: flex;
          }
        }
      `}</style>

      <nav className="wrap" aria-label="Navegación móvil inferior">
        <div className="navShell">
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
                    <Icon active={item.active} />
                    <span className="indicator" />
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