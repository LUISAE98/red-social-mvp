"use client";

import { useRef, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

export type WalletTabKey =
  | "finances"
  | "statistics"
  | "calendar"
  | "pending"
  | "history";

type WalletTabItem = {
  key: WalletTabKey;
  href: string;
  icon: VibraNavigationIconType;
};

const TABS: WalletTabItem[] = [
  { key: "finances", href: "/wallet/finanzas", icon: "coin" },
  { key: "statistics", href: "/wallet/estadisticas", icon: "finance" },
  { key: "calendar", href: "/wallet/calendario", icon: "calendar" },
  { key: "pending", href: "/wallet/pendientes", icon: "pending" },
  { key: "history", href: "/wallet/historial", icon: "history" },
];

export default function WalletSubNav({
  activeTab,
}: {
  activeTab: WalletTabKey;
}) {
  const t = useTranslations("nav");
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const navRef = useRef<HTMLDivElement | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const activeIndex = TABS.findIndex((t) => t.key === activeTab);
    const tabEl = tabRefs.current[activeIndex];
    const navEl = navRef.current;
    if (!tabEl || !navEl) return;

    const tabRect = tabEl.getBoundingClientRect();
    const navRect = navEl.getBoundingClientRect();
    const indicatorW = Math.min(72, tabRect.width - 20);
    const left = tabRect.left - navRect.left + (tabRect.width - indicatorW) / 2;
    setIndicatorStyle({ left, width: indicatorW });
  }, [activeTab]);

  return (
    <>
      <style jsx>{`
        .wrap {
          width: 100%;
          overflow-x: hidden;
          container-type: inline-size;
        }

        .nav {
          position: relative;
          width: 100%;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          align-items: stretch;
        }

        .tabLink {
          text-decoration: none;
          min-width: 0;
        }

        /* Base = solo icono (compacto), para celular y laptops estrechas. */
        .tabInner {
          min-width: 0;
          min-height: 52px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 0 8px 10px;
          color: rgba(168, 85, 247, 0.55);
          font-size: 16px;
          font-weight: 500;
          line-height: 1;
          letter-spacing: -0.02em;
          white-space: nowrap;
          transition: color 0.18s ease;
        }

        .tabContent {
          display: flex;
          align-items: center;
          gap: 0;
        }

        .tabLink:hover .tabInner {
          color: #c084fc;
        }

        .tabInnerActive {
          color: #c084fc;
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
          display: none;
          min-width: 0;
        }

        .indicator {
          position: absolute;
          bottom: 7px;
          height: 3px;
          border-radius: 999px;
          background: #a855f7;
          transition: left 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                      width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                      opacity 0.18s ease;
        }

        /* Con ancho suficiente en el subnav: se muestra el texto y el icono normal. */
        @container (min-width: 760px) {
          .tabInner {
            min-height: 56px;
            padding: 0 10px 10px;
            gap: 9px;
          }

          .tabContent {
            gap: 8px;
          }

          .label {
            display: inline-block;
          }
        }
      `}</style>

      <style jsx global>{`
        /* Base: icono grande (modo solo-icono). */
        .walletSubNavEmoji .vibraNavigationIconSvg {
          width: 28px !important;
          height: 28px !important;
        }
        @container (min-width: 760px) {
          .walletSubNavEmoji .vibraNavigationIconSvg {
            width: 22px !important;
            height: 22px !important;
          }
        }
      `}</style>
      <VibraNavigationIconsStyles />

      <div className="wrap">
        <nav ref={navRef} className="nav" aria-label={t("walletNavLabel")}>
          {TABS.map((tab, index) => {
            const isActive = activeTab === tab.key;

            return (
              <Link
                key={tab.key}
                href={tab.href}
                ref={(el) => { tabRefs.current[index] = el; }}
                className="tabLink"
                aria-current={isActive ? "page" : undefined}
              >
                <span className={`tabInner ${isActive ? "tabInnerActive" : ""}`}>
                  <span className="tabContent">
                    <span className="emoji walletSubNavEmoji" aria-hidden="true">
                      <VibraNavigationIcon type={tab.icon} size={22} strokeWidth={2} />
                    </span>
                    <span className="label">{t(tab.key)}</span>
                  </span>
                </span>
              </Link>
            );
          })}

          {/* Sliding indicator — single element outside the tabs */}
          {indicatorStyle ? (
            <span
              className="indicator"
              style={{
                left: indicatorStyle.left,
                width: indicatorStyle.width,
                opacity: 1,
              }}
            />
          ) : null}
        </nav>
      </div>
    </>
  );
}
