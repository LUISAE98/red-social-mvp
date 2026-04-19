"use client";

import Link from "next/link";

export type WalletTabKey = "finances" | "calendar" | "pending" | "history";

type WalletTabItem = {
  key: WalletTabKey;
  label: string;
  href: string;
  emoji: string;
};

const TABS: WalletTabItem[] = [
  { key: "finances", label: "Finanzas", href: "/wallet/finanzas", emoji: "📈" },
  { key: "calendar", label: "Calendario", href: "/wallet/calendario", emoji: "📅" },
  { key: "pending", label: "Pendientes", href: "/wallet/pendientes", emoji: "⏳" },
  { key: "history", label: "Historial", href: "/wallet/historial", emoji: "🧾" },
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
          overflow-x: hidden;
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
          gap: 8px;
          padding: 0 10px 10px;
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

        .emoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          line-height: 1;
          flex-shrink: 0;
        }

        .label {
          display: inline-block;
          min-width: 0;
        }

        .indicator {
          position: absolute;
          left: 50%;
          bottom: 2px;
          transform: translateX(-50%);
          width: 72px;
          max-width: calc(100% - 20px);
          height: 3px;
          border-radius: 999px;
          background: #ffffff;
        }

        @media (max-width: 900px) {
          .tabInner {
            min-height: 52px;
            padding: 0 8px 8px;
            gap: 0;
          }

          .emoji {
            font-size: 19px;
          }

          .label {
            display: none;
          }

          .indicator {
            width: 34px;
            max-width: calc(100% - 16px);
            bottom: 3px;
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
                  <span className="emoji" aria-hidden="true">
                    {tab.emoji}
                  </span>
                  <span className="label">{tab.label}</span>
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