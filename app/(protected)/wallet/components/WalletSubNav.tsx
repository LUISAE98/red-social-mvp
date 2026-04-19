"use client";

import Link from "next/link";

export type WalletTabKey = "finances" | "calendar" | "pending" | "history";

type WalletTabItem = {
  key: WalletTabKey;
  label: string;
  href: string;
};

const TABS: WalletTabItem[] = [
  { key: "finances", label: "Finanzas", href: "/wallet/finanzas" },
  { key: "calendar", label: "Calendario", href: "/wallet/calendario" },
  { key: "pending", label: "Pendientes", href: "/wallet/pendientes" },
  { key: "history", label: "Historial", href: "/wallet/historial" },
];

export default function WalletSubNav({
  activeTab,
}: {
  activeTab: WalletTabKey;
}) {
  return (
    <>
      <style jsx>{`
        .wrap {
          width: 100%;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .wrap::-webkit-scrollbar {
          display: none;
        }

        .nav {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          align-items: stretch;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .tabLink {
          text-decoration: none;
          min-width: 0;
        }

        .tabInner {
          position: relative;
          min-width: 0;
          min-height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 10px 12px;
          color: rgba(255, 255, 255, 0.72);
          font-size: 16px;
          font-weight: 500;
          line-height: 1;
          letter-spacing: -0.02em;
          white-space: nowrap;
          transition: color 0.18s ease, opacity 0.18s ease;
        }

        .tabLink:hover .tabInner {
          color: #ffffff;
        }

        .tabInnerActive {
          color: #ffffff;
          font-weight: 700;
        }

        .indicator {
          position: absolute;
          left: 50%;
          bottom: -1px;
          transform: translateX(-50%);
          width: 72px;
          max-width: calc(100% - 20px);
          height: 3px;
          border-radius: 999px;
          background: #ffffff;
        }

        @media (max-width: 900px) {
          .nav {
            min-width: 640px;
          }

          .tabInner {
            min-height: 52px;
            padding: 0 10px 11px;
            font-size: 15px;
          }

          .indicator {
            width: 62px;
            max-width: calc(100% - 18px);
          }
        }
      `}</style>

      <div className="wrap">
        <nav className="nav" aria-label="Secciones de wallet">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;

            return (
              <Link
                key={tab.key}
                href={tab.href}
                className="tabLink"
                aria-current={isActive ? "page" : undefined}
              >
                <span className={`tabInner ${isActive ? "tabInnerActive" : ""}`}>
                  {tab.label}
                  {isActive ? <span className="indicator" /> : null}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}