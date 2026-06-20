"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import LogoutButton from "@/app/LogoutButton";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

type WalletRailTab = "finances" | "calendar" | "pending" | "history";
type MainRailTab = "home" | "saved";

function resolveWalletRailTab(pathname: string): WalletRailTab | null {
  if (pathname.startsWith("/wallet/finanzas")) return "finances";
  if (pathname.startsWith("/wallet/calendario")) return "calendar";
  if (pathname.startsWith("/wallet/pendientes")) return "pending";
  if (pathname.startsWith("/wallet/historial")) return "history";
  return null;
}

function resolveMainRailTab(pathname: string): MainRailTab | null {
  if (pathname === "/" || pathname.startsWith("/home")) return "home";
  if (pathname.startsWith("/saved")) return "saved";
  return null;
}

function usePersistentSidebarScroll(key: string, restoreSignal?: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isRestoringRef = useRef(false);

  const restoreScroll = () => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = sessionStorage.getItem(key);
    if (saved === null) return;

    const target = Number(saved);
    if (!Number.isFinite(target)) return;

    isRestoringRef.current = true;

    el.scrollTop = target;

    setTimeout(() => {
      el.scrollTop = target;
      isRestoringRef.current = false;
    }, 80);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saveScroll = () => {
      if (isRestoringRef.current) return;
      const canScroll = el.scrollHeight > el.clientHeight + 1;
      if (!canScroll) return;
      sessionStorage.setItem(key, String(el.scrollTop));
    };

    el.addEventListener("scroll", saveScroll, { passive: true });

    return () => {
      saveScroll();
      el.removeEventListener("scroll", saveScroll);
    };
  }, [key]);

  useLayoutEffect(() => {
    restoreScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, restoreSignal]);

  return scrollRef;
}

export default function WalletDesktopRail({
  activePath,
  showWallet,
}: {
  activePath: string;
  showWallet: boolean;
}) {
  const walletItems: Array<{
    key: WalletRailTab;
    label: string;
    href: string;
    icon: VibraNavigationIconType;
  }> = [
    { key: "finances", label: "Finanzas", href: "/wallet/finanzas", icon: "finance" },
    { key: "calendar", label: "Calendario", href: "/wallet/calendario", icon: "calendar" },
    { key: "pending", label: "Pendientes", href: "/wallet/pendientes", icon: "pending" },
    { key: "history", label: "Historial", href: "/wallet/historial", icon: "history" },
  ];

  const mainItems: Array<{
    key: MainRailTab;
    label: string;
    href: string;
    icon: VibraNavigationIconType;
  }> = [
    { key: "home", label: "Inicio", href: "/", icon: "home" },
    { key: "saved", label: "Guardados", href: "/saved", icon: "saved" },
  ];

  const [walletOpen, setWalletOpen] = useState(false);

  const activeWalletTab = resolveWalletRailTab(activePath);
  const activeMainTab = resolveMainRailTab(activePath);
  const sidebarScrollRef = usePersistentSidebarScroll(
    "vibra-wallet-rail-scroll",
    showWallet
  );

  return (
    <>
      <VibraNavigationIconsStyles />

      <style jsx>{`
        .walletRail {
          width: min(100%, 250px);
          height: 100%;
          min-height: 0;
          margin-left: auto;
          margin-right: auto;
          overflow: hidden;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }

        .walletRailCenter {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: clamp(12px, 2vh, 20px);
          overflow-y: auto;
          overflow-x: hidden;
          padding-bottom: 18px;
          scrollbar-width: none;
        }

        .walletRailCenter::-webkit-scrollbar {
          display: none;
        }

        .railSection {
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px 14px;
          box-sizing: border-box;
          border-radius: 12px;
          border: 1px solid rgba(168, 85, 255, 0.08);
          background:
            linear-gradient(
              135deg,
              rgb(3, 3, 6) 0%,
              rgb(8, 5, 13) 48%,
              rgb(0, 0, 0) 100%
            );
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.035),
            inset 0 -1px 0 rgba(255, 255, 255, 0.015),
            inset 0 0 14px rgba(168, 85, 255, 0.012),
            0 0 8px rgba(168, 85, 255, 0.022),
            0 18px 54px rgba(0, 0, 0, 0.68);
        }

        .railSection::before {
          content: "";
          position: absolute;
          inset: -38%;
          border-radius: inherit;
          pointer-events: none;
          background:
            radial-gradient(circle at 18% 10%, rgba(168, 85, 255, 0.045), transparent 34%),
            radial-gradient(circle at 86% 18%, rgba(126, 34, 206, 0.032), transparent 36%),
            radial-gradient(circle at 22% 92%, rgba(168, 85, 255, 0.025), transparent 40%);
          filter: blur(24px);
          opacity: 0.32;
          z-index: 0;
        }

        .railSection::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          box-shadow:
            inset 0 0 18px rgba(79, 70, 255, 0.045),
            inset 0 0 14px rgba(168, 85, 255, 0.045),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          z-index: 1;
        }

        .railSection > * {
          position: relative;
          z-index: 2;
        }

        .railSection + .railSection {
          margin-top: 0;
        }

        .createCommunitySection + .railSection {
          margin-top: 0;
        }

        .logoutSection {
          width: 100%;
          margin-top: 14px;
          flex: 0 0 auto;
        }

        .logoutSection :global(button) {
          width: 100%;
          height: 40px;
          min-height: 40px;
          filter: saturate(0.84) brightness(0.93);
          box-shadow: 0 7px 18px rgba(168, 85, 255, 0.11);
        }

        @media (max-height: 760px) {
          .createCommunitySection {
            transform: none;
          }

          .walletRailCenter {
            gap: 10px;
          }

          .railSection {
            padding: 12px 14px;
            gap: 6px;
          }

          .createCommunityImage {
            width: 200px;
            max-width: 200px;
            margin: -8px auto -16px;
          }

          .createCommunityCopy {
            margin-bottom: 2px;
          }

          .createCommunityCopy strong {
            font-size: 14px;
          }

          .createCommunityCopy span {
            font-size: 11px;
            line-height: 1.12;
          }

          .createCommunitySection :global(.createCommunityButton) {
            height: 36px;
            min-height: 36px;
          }

          .logoutSection :global(button) {
            height: 38px;
            min-height: 38px;
          }
        }

        .walletToggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
          text-align: left;
        }

        .walletToggleIcon {
          font-size: 20px;
          line-height: 1;
          font-weight: 300;
          color: rgba(255, 255, 255, 0.6);
          flex-shrink: 0;
          user-select: none;
          transition: color 180ms ease;
        }

        .walletToggle:hover .walletToggleIcon {
          color: rgba(255, 255, 255, 0.9);
        }

        .walletTitle {
          margin: 0;
          font-size: 17px;
          line-height: 1.2;
          font-weight: 550;
          letter-spacing: -0.02em;
          color: #fff;
        }

        .secondaryTitle {
          margin: 0 0 2px;
          font-size: 17px;
          line-height: 1.2;
          font-weight: 550;
          letter-spacing: -0.02em;
          color: #fff;
        }

        @keyframes railAuraMove {
          from {
            transform: translate3d(-2%, -1%, 0) scale(1);
          }

          to {
            transform: translate3d(2%, 1.5%, 0) scale(1.06);
          }
        }

        .createCommunitySection {
          padding: 0;
          border: none;
          background: transparent;
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          overflow: visible;
          margin-top: 0;
          gap: clamp(3px, 0.55vh, 6px);
          align-items: center;
          transform: none;
        }

        .createCommunitySection::before,
        .createCommunitySection::after {
          display: none;
        }

        .createCommunityImage {
          width: 300px;
          max-width: 300px;
          height: auto;
          display: block;
          margin: -6px auto -14px;
          object-fit: contain;
          transform: translateX(-35px);
        }

        .createCommunityCopy {
          margin-bottom: 5px;
          display: grid;
          gap: 2px;
          color: #fff;
          text-align: center;
          justify-items: center;
          font-family: inherit;
        }

        .createCommunityCopy strong {
          font-size: 16px;
          font-weight: 600;
          line-height: 1.08;
          letter-spacing: -0.02em;
        }

        .createCommunityCopy span {
          font-size: 12px;
          font-weight: 400;
          line-height: 1.28;
          color: rgba(255, 255, 255, 0.76);
        }

        .createCommunitySection :global(.createCommunityButton) {
          opacity: 0.85;
          width: 100%;
          height: 40px;
          min-height: 40px;
          padding: 8px 14px;
          border-radius: 10px;
          border: none;
          background-image: linear-gradient(
            100deg,
            #ff2fb3 0%,
            #a855ff 35%,
            #4f46ff 70%,
            #ff2fb3 100%
          );
          background-size: 280% 280%;
          background-position: 0% 50%;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 7px 18px rgba(168, 85, 255, 0.11);
          filter: saturate(0.84) brightness(0.93);
          overflow: hidden;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        .walletNav {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .walletLink:hover {
          color: rgba(255, 255, 255, 0.84);
          transform: translateX(2px);
        }

        .walletLink:hover .walletIcon {
          color: rgba(255, 255, 255, 0.72);
          opacity: 0.86;
          filter: saturate(0.7) brightness(1);
        }

        .walletIcon {
          width: 22px;
          min-width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.68);
          opacity: 0.82;
          filter: saturate(0.65) brightness(0.96);
          transform: translateY(3.5px);
          margin-right: 8px;
          transition:
            color 180ms ease,
            opacity 180ms ease,
            filter 180ms ease;
        }

        .walletLabel {
          min-width: 0;
          white-space: nowrap;
          color: rgba(255, 255, 255, 0.74);
          transition: color 180ms ease;
        }

        :global(.walletLinkActive) .walletIcon {
          color: #a855ff;
          opacity: 1;
          filter: saturate(1) brightness(1);
        }

        :global(.walletLinkActive) .walletLabel {
          color: #ffffff;
        }

        :global(.walletLinkActive) {
          color: #ffffff;
          font-weight: 700;
          border-radius: 15px;
          position: relative;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% 50%, rgba(236, 72, 153, 0.23), transparent 34%),
            radial-gradient(circle at 80% 45%, rgba(79, 70, 229, 0.25), transparent 36%),
            radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.23), transparent 42%),
            linear-gradient(
              135deg,
              #09090f 0%,
              #050509 52%,
              #000000 100%
            );
          padding: 3px 12px;
          margin-left: -2px;
          margin-right: -2px;
          box-shadow:
            inset 0 0 10px rgba(255, 255, 255, 0.04),
            inset 0 0 18px rgba(124, 58, 237, 0.16),
            0 0 14px rgba(124, 58, 237, 0.20);
        }

        :global(.walletLinkActive)::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          background:
            linear-gradient(
              110deg,
              transparent 0%,
              rgba(236, 72, 153, 0.13) 25%,
              rgba(124, 58, 237, 0.18) 50%,
              rgba(79, 70, 229, 0.13) 75%,
              transparent 100%
            );
          opacity: 0.82;
        }

        @keyframes walletActiveAura {
          0% {
            transform: translateX(-8%);
          }

          100% {
            transform: translateX(8%);
          }
        }
      `}</style>

      <aside className="walletRail" aria-label="Accesos directos">
        <div className="walletRailCenter" ref={sidebarScrollRef}>
          <section className="railSection mainMenuSection" aria-label="Navegación principal">
            <h3 className="secondaryTitle">Menú</h3>

            <nav className="walletNav">
              {mainItems.map((item) => {
                const isActive = activeMainTab === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`walletLink ${isActive ? "walletLinkActive" : ""}`}
                  >
                    <span className="walletIcon" aria-hidden="true">
                      <VibraNavigationIcon type={item.icon} size={21} />
                    </span>
                    <span className="walletLabel">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </section>

          <section className="railSection createCommunitySection" aria-label="Crear comunidad">
            <Image
              src="/Crear-comunidad.png"
              alt=""
              width={280}
              height={187}
              className="createCommunityImage"
              aria-hidden="true"
            />

            <div className="createCommunityCopy">
              <strong>Crea tu comunidad</strong>
              <span>
                Conecta, comparte y
                <br />
                monetiza tu pasión.
              </span>
            </div>

            <Link href="/groups/new" className="createCommunityButton">
              Crear comunidad
            </Link>
          </section>

          {showWallet ? (
            <section className="railSection" aria-label="Wallet">
              <button
                type="button"
                className="walletToggle"
                onClick={() => setWalletOpen((o) => !o)}
                aria-expanded={walletOpen}
              >
                <h3 className="walletTitle">Wallet</h3>
                <span className="walletToggleIcon" aria-hidden="true">
                  {walletOpen ? "−" : "+"}
                </span>
              </button>

              {walletOpen ? (
                <nav className="walletNav">
                  {walletItems.map((item) => {
                    const isActive = activeWalletTab === item.key;
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={`walletLink ${isActive ? "walletLinkActive" : ""}`}
                      >
                        <span className="walletIcon" aria-hidden="true">
                          <VibraNavigationIcon type={item.icon} size={21} />
                        </span>
                        <span className="walletLabel">{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className="logoutSection" aria-label="Cerrar sesión">
          <LogoutButton variant="settings" />
        </section>
      </aside>
    </>
  );
}
