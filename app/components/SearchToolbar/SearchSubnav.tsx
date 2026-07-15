"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  VibraSubnavIcon,
  VibraSubnavIconsStyles,
  type VibraSubnavIconType,
} from "@/app/components/VibraServiceIcons/VibraSubNavIcons";

type TabType = "groups" | "profiles" | "posts" | "stories";

const TAB_ORDER: TabType[] = ["stories", "profiles", "groups", "posts"];
const ICON_BY_TAB: Record<TabType, VibraSubnavIconType> = {
  groups: "communities",
  profiles: "profiles",
  posts: "posts",
  stories: "stories",
};

type SearchSubnavProps = {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
};

export default function SearchSubnav({
  activeTab,
  onChangeTab,
}: SearchSubnavProps) {
  const tNav = useTranslations("nav");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navRef = useRef<HTMLDivElement | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  const labelByTab: Record<TabType, string> = {
    groups: tNav("searchTabGroups"),
    profiles: tNav("searchTabProfiles"),
    posts: tNav("searchTabPosts"),
    stories: tNav("searchTabStories"),
  };

  // Indicador morado deslizante bajo la pestaña activa (mismo patrón que WalletSubNav).
  const recomputeIndicator = useCallback(() => {
    const activeIndex = TAB_ORDER.indexOf(activeTab);
    const tabEl = tabRefs.current[activeIndex];
    const navEl = navRef.current;
    if (!tabEl || !navEl) return;
    const tabRect = tabEl.getBoundingClientRect();
    const navRect = navEl.getBoundingClientRect();
    const indicatorW = Math.min(72, tabRect.width - 20);
    const left = tabRect.left - navRect.left + (tabRect.width - indicatorW) / 2;
    setIndicatorStyle({ left, width: indicatorW });
  }, [activeTab]);

  useEffect(() => {
    recomputeIndicator();
    window.addEventListener("resize", recomputeIndicator);
    return () => window.removeEventListener("resize", recomputeIndicator);
  }, [recomputeIndicator]);

  return (
    <>
      <VibraSubnavIconsStyles />

      <style jsx>{`
        .wrap {
          width: min(100%, 1040px);
          margin: 0 auto 18px;
          overflow-x: hidden;
          container-type: inline-size;
        }

        .nav {
          position: relative;
          width: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          align-items: stretch;
        }

        /* Base = solo icono (compacto), para celular y anchos estrechos. */
        .tabInner {
          min-width: 0;
          min-height: 52px;
          border: 0;
          background: transparent;
          cursor: pointer;
          font-family: inherit;
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

        .tabInner:hover {
          color: #c084fc;
        }

        .tabInnerActive {
          color: #c084fc;
          font-weight: 700;
        }

        .tabContent {
          display: flex;
          align-items: center;
          gap: 0;
        }

        .emoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
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

        /* Con ancho suficiente: se muestra el texto junto al icono. */
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
        .search-subnav-icon .vibraSubnavIconSvg {
          width: 27px !important;
          height: 27px !important;
        }
        @container (min-width: 760px) {
          .search-subnav-icon .vibraSubnavIconSvg {
            width: 22px !important;
            height: 22px !important;
          }
        }
      `}</style>

      <div className="wrap">
        <nav ref={navRef} className="nav" aria-label={tNav("searchTabsAriaLabel")}>
          {TAB_ORDER.map((key, index) => {
            const active = activeTab === key;

            return (
              <button
                key={key}
                type="button"
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                className={`tabInner ${active ? "tabInnerActive" : ""}`}
                onClick={() => onChangeTab(key)}
                aria-current={active ? "page" : undefined}
              >
                <span className="tabContent">
                  <span className="emoji search-subnav-icon" aria-hidden="true">
                    <VibraSubnavIcon
                      type={ICON_BY_TAB[key]}
                      label={labelByTab[key]}
                      size={24}
                      strokeWidth={key === "stories" ? 2.7 : 2}
                    />
                  </span>
                  <span className="label">{labelByTab[key]}</span>
                </span>
              </button>
            );
          })}

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
