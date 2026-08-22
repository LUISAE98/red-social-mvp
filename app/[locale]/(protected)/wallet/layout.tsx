"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import WalletSubNav, { type WalletTabKey } from "./components/WalletSubNav";
import WalletOnboarding from "./components/WalletOnboarding";
import { WalletDataContext } from "./components/WalletDataContext";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { useAuth } from "@/app/providers";

function pathToTab(pathname: string): WalletTabKey {
  if (pathname.includes("/estadisticas")) return "statistics";
  if (pathname.includes("/calendario")) return "calendar";
  if (pathname.includes("/pendientes")) return "pending";
  if (pathname.includes("/historial")) return "history";
  return "finances";
}

export default function WalletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);

  // Mismo gate que la sección Wallet del rail derecho: sin servicios activos y
  // sin ninguna solicitud histórica, la wallet no es un reporte sino una
  // invitación a empezar. `loaded` evita decidir con datos a medias.
  const { hasWallet: hasMonetization, loaded: monetizationLoaded } =
    useWalletVisibility(user?.uid);
  const showOnboarding = monetizationLoaded && !hasMonetization;

  const pathname = usePathname();
  const activeTab = pathToTab(pathname);

  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty(
        "--wallet-header-bottom",
        `${el.getBoundingClientRect().bottom}px`
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--wallet-header-bottom");
    };
  }, []);

  return (
    <>
      <style jsx>{`
        .walletLayout {
          width: 100%;
          color: #ffffff;
          font-family: inherit;
        }

        .walletHeader {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 6px;
        }

        /* El aspecto sale de ".vibra-page-title" (globals.css), como el de
           guardados, notificaciones o experiencias. Este era el que más se
           separaba —44px y 700— y hacía que entrar a la wallet se sintiera como
           cambiar de aplicación. Su tamaño elástico ya encoge solo en pantallas
           estrechas, así que la variante de móvil que había abajo tampoco hace
           falta. */

        /* Recorta el deslizamiento de llegada de la pestaña, que entra desde
           fuera del ancho. La animación en si la pone WalletSectionShell, ya
           dentro de la frontera de Suspense. */
        .walletContent {
          overflow: hidden;
        }

        @media (max-width: 900px) {
          .walletLayout {
            padding-inline-start: 12px;
            padding-inline-end: 12px;
            box-sizing: border-box;
          }

          /* El onboarding va a pantalla completa en celular (sin márgenes negros
             a los lados); sus secciones ya tienen su propio padding interno. */
          .walletLayout.walletLayoutFull {
            padding-inline-start: 0;
            padding-inline-end: 0;
          }

          .walletHeader {
            gap: 6px;
            margin-bottom: 4px;
          }

        }
      `}</style>

      <WalletDataContext.Provider value={walletData}>
        <div className={`walletLayout${showOnboarding ? " walletLayoutFull" : ""}`}>
          <div ref={headerRef} className="walletHeader">
            {/* En onboarding el encabezado "Wallet" y las pestañas se ocultan:
                la wallet aún no es un panel sino una invitación a empezar. */}
            {monetizationLoaded && !showOnboarding ? (
              <>
                <h1 className="vibra-page-title">Wallet</h1>
                <WalletSubNav activeTab={activeTab} />
              </>
            ) : null}
          </div>

          <div className="walletContent">
            {!monetizationLoaded ? null : showOnboarding ? (
              <WalletOnboarding />
            ) : (
              children
            )}
          </div>
        </div>
      </WalletDataContext.Provider>
    </>
  );
}
