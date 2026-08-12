"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { useAuth } from "@/app/providers";
import { useWalletFinances, selectFinanceView } from "@/lib/wallet/walletFinances";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useBalanceHidden, toggleBalanceHidden } from "@/lib/wallet/useBalanceHidden";
import MaskedAmount from "@/app/components/MaskedAmount";

type WalletRailTab =
  | "finances"
  | "statistics"
  | "calendar"
  | "pending"
  | "history";
type MainRailTab = "home" | "saved";

function resolveWalletRailTab(pathname: string): WalletRailTab | null {
  if (pathname.startsWith("/wallet/finanzas")) return "finances";
  if (pathname.startsWith("/wallet/estadisticas")) return "statistics";
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

  // Marca si ya pasamos la "entrada" (inicio de sesión / primera aparición del
  // rail). Durante la entrada NO restauramos la posición guardada, para no
  // heredar el scroll hasta abajo que deja el wallet abierto: empezamos arriba.
  const enteredRef = useRef(false);

  useLayoutEffect(() => {
    if (!enteredRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
      // La entrada termina cuando el wallet ya se muestra (restoreSignal true);
      // a partir de ahí la restauración funciona normal en cambios posteriores.
      if (restoreSignal) enteredRef.current = true;
      return;
    }
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
  const t = useTranslations("nav");
  const { user } = useAuth();
  const { summary, loading: walletLoading } = useWalletFinances(user?.uid);
  const { format } = usePriceFormat();
  const view = selectFinanceView(summary, "net");
  // Toggle de privacidad (compartido con la cartera del header).
  const balanceHidden = useBalanceHidden();

  const walletItems: Array<{
    key: WalletRailTab;
    href: string;
    icon: VibraNavigationIconType;
  }> = [
    { key: "finances", href: "/wallet/finanzas", icon: "coin" },
    { key: "statistics", href: "/wallet/estadisticas", icon: "finance" },
    { key: "calendar", href: "/wallet/calendario", icon: "calendar" },
    { key: "pending", href: "/wallet/pendientes", icon: "history" },
    { key: "history", href: "/wallet/historial", icon: "pending" },
  ];

  const mainItems: Array<{
    key: MainRailTab;
    href: string;
    icon: VibraNavigationIconType;
  }> = [
    { key: "home", href: "/", icon: "home" },
    { key: "saved", href: "/saved", icon: "saved" },
  ];

  const [walletOpen, setWalletOpen] = useState(true);

  const activeWalletTab = resolveWalletRailTab(activePath);
  const activeMainTab = resolveMainRailTab(activePath);
  const sidebarScrollRef = usePersistentSidebarScroll(
    "vibra-wallet-rail-scroll",
    showWallet
  );

  const handleWalletToggle = () => {
    const opening = !walletOpen;
    setWalletOpen(opening);
    if (opening) {
      // Tras expandir (la animación dura 360ms), desliza el rail hacia abajo
      // para revelar todos los ítems del wallet.
      window.setTimeout(() => {
        const el = sidebarScrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, 380);
    } else {
      // Al cerrar, regresa el rail hacia arriba.
      const el = sidebarScrollRef.current;
      if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

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
          /* Difumina el contenido en los bordes superior e inferior en vez de
             cortarlo de golpe al hacer scroll. La máscara se aplica sobre el área
             visible, así el contenido se desvanece al pasar por los extremos. */
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0,
            #000 22px,
            #000 calc(100% - 22px),
            transparent 100%
          );
          mask-image: linear-gradient(
            to bottom,
            transparent 0,
            #000 22px,
            #000 calc(100% - 22px),
            transparent 100%
          );
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
          /* Contenedor invisible: sin fondo, borde ni sombra, para que no se note. */
          border: none;
          background: transparent;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          box-shadow: none;
        }

        /* Glow y sombra interna desactivados: el contenedor no debe notarse. */
        .railSection::before,
        .railSection::after {
          content: none;
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

        /* Línea que separa el menú (inicio/guardados) de "crea tu comunidad".
           El gap de .walletRailCenter aporta el espacio vertical; los 14px
           laterales la alinean con el padding interno de las secciones. */
        .railDivider {
          flex-shrink: 0;
          height: 1px;
          margin: 0 14px;
          background: rgba(255, 255, 255, 0.1);
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
        }

        .walletToggle {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
          text-align: left;
          gap: 6px;
        }

        /* Entrada simple de wallet (sin servicios activos): icono + título EN FILA.
           :global porque va sobre un <Link> (componente): styled-jsx no scopea la
           clase en componentes, así que sin :global no aplicaba el flex y el título
           caía debajo del icono. */
        :global(.walletEntryLink) {
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          text-decoration: none;
          border-radius: 8px;
          transition: opacity 140ms ease;
        }

        :global(.walletEntryLink:hover) {
          opacity: 0.82;
        }

        .walletToggleTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
        }

        .walletTitleGroup {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .walletTitleIcon {
          display: flex;
          align-items: center;
          color: rgba(255, 255, 255, 0.7);
          flex-shrink: 0;
        }

        .walletBalanceBlock {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          margin-top: 8px;
          margin-bottom: 8px;
        }

        .walletBalanceLabel {
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: none;
          color: rgba(255, 255, 255, 0.32);
          line-height: 1;
        }

        .walletBalanceAmount {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1;
          color: #4ade80;
          transition: color 300ms ease;
          font-variant-numeric: tabular-nums;
        }

        .walletBalanceAmount.loading {
          color: rgba(74, 222, 128, 0.35);
        }

        /* Monto + ojito para ocultar el saldo (privacidad). */
        .walletBalanceRow {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }

        .walletEye {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          border-radius: 6px;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          transition: color 140ms ease, background 140ms ease;
        }

        .walletEye:hover {
          color: rgba(255, 255, 255, 0.9);
          background: rgba(255, 255, 255, 0.08);
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
            #a855f7 35%,
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
          color: #a855f7;
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

        .walletPanelOuter {
          overflow: hidden;
          transition: max-height 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease;
        }
      `}</style>

      <aside className="walletRail" aria-label={t("sidebarLabel")}>
        <div className="walletRailCenter" ref={sidebarScrollRef}>
          <section className="railSection mainMenuSection" aria-label={t("mainNavLabel")}>
            <h3 className="secondaryTitle">{t("menu")}</h3>

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
                    <span className="walletLabel">{t(item.key)}</span>
                  </Link>
                );
              })}
            </nav>
          </section>

          <div className="railDivider" aria-hidden="true" />

          {showWallet ? (
            <section className="railSection" aria-label={t("wallet")}>
              <button
                type="button"
                className="walletToggle"
                onClick={handleWalletToggle}
                aria-expanded={walletOpen}
              >
                <span className="walletToggleTop">
                  <span className="walletTitleGroup">
                    <span className="walletTitleIcon" aria-hidden="true">
                      <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
                        <rect x="3" y="7" width="18" height="12" rx="2.5" />
                        <path d="M16 12.5h3" />
                      </svg>
                    </span>
                    <h3 className="walletTitle">{t("wallet")}</h3>
                  </span>
                  <span className="walletToggleIcon" aria-hidden="true">
                    {walletOpen ? "−" : "+"}
                  </span>
                </span>
                <span className="walletBalanceBlock">
                  <span className="walletBalanceLabel">Disponible</span>
                  <span className="walletBalanceRow">
                    <span className={`walletBalanceAmount${walletLoading ? " loading" : ""}`}>
                      {walletLoading ? (
                        "···"
                      ) : balanceHidden && view.available > 0 ? (
                        <MaskedAmount formatted={format(view.available, { baseCurrency: summary.currency ?? "MXN" })} />
                      ) : (
                        format(view.available, { baseCurrency: summary.currency ?? "MXN" })
                      )}
                    </span>
                    {!walletLoading && view.available > 0 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className="walletEye"
                        aria-label={balanceHidden ? t("showAmount") : t("hideAmount")}
                        aria-pressed={balanceHidden}
                        onClick={(e) => { e.stopPropagation(); toggleBalanceHidden(); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleBalanceHidden();
                          }
                        }}
                      >
                        {balanceHidden ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>

              <div
                className="walletPanelOuter"
                style={{
                  maxHeight: walletOpen ? "1200px" : "0",
                  opacity: walletOpen ? 1 : 0,
                }}
              >
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
                        <span className="walletLabel">{t(item.key)}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </section>
          ) : (
            /* Sin servicios activos: no se despliega ni muestra cifra. Solo
               "Wallet" + icono; al hacer clic va a la presentación de onboarding. */
            <section className="railSection" aria-label={t("wallet")}>
              <Link href="/wallet/finanzas" className="walletEntryLink">
                <span className="walletTitleIcon" aria-hidden="true">
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
                    <rect x="3" y="7" width="18" height="12" rx="2.5" />
                    <path d="M16 12.5h3" />
                  </svg>
                </span>
                <h3 className="walletTitle">{t("wallet")}</h3>
              </Link>
            </section>
          )}

          {/* División propia del botón de wallet (tanto activa como no activa). */}
          <div className="railDivider" aria-hidden="true" />

          <section className="railSection createCommunitySection" aria-label={t("createCommunityLabel")}>
            <Image
              src="/Crear-comunidad.webp"
              alt=""
              width={280}
              height={187}
              className="createCommunityImage"
              aria-hidden="true"
            />

            <div className="createCommunityCopy">
              <strong>{t("createCommunityTitle")}</strong>
              <span>{t("createCommunitySubtitle")}</span>
            </div>

            <Link href="/groups/new" className="createCommunityButton">
              {t("createCommunityButton")}
            </Link>
          </section>
        </div>
      </aside>
    </>
  );
}
