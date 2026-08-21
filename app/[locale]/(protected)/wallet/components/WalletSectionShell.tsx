"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { type WalletTabKey } from "./WalletSubNav";

/**
 * Envoltura de cada pestaña de la wallet. Aquí vive la animación de llegada, y
 * el sitio importa.
 *
 * Antes la ponía `wallet/layout.tsx`, con `key={pathname}` — o sea, FUERA de la
 * frontera de Suspense que abre `wallet/loading.tsx`. Al pulsar una pestaña el
 * pathname cambia de inmediato, así que el deslizamiento arrancaba mientras el
 * segmento nuevo seguía suspendido; y como ese fallback no dibuja nada a
 * propósito, lo que se deslizaba era una caja vacía. Para cuando el contenido
 * llegaba, el muelle ya se había consumido y la pestaña simplemente aparecía.
 *
 * Dentro de la frontera, en cambio, este componente se monta exactamente cuando
 * el contenido real está listo: el deslizamiento y lo que se desliza entran a
 * la vez, haya suspensión o no.
 */

const TAB_ORDER: Record<WalletTabKey, number> = {
  finances: 0,
  statistics: 1,
  calendar: 2,
  pending: 3,
  history: 4,
};

/**
 * De qué lado entra la pestaña. Vive en el módulo, no en `sessionStorage`, para
 * que leer la anterior y apuntar la nueva ocurran en el mismo instante: con un
 * efecto de por medio, un remonte podía leer el valor ya actualizado y devolver
 * 0, que es "sin animación".
 *
 * Repetir la llamada con la misma pestaña devuelve lo mismo sin recalcular, así
 * que el doble render de StrictMode no la rompe.
 */
let tabAnterior: WalletTabKey | null = null;
let ultimaDireccion = 0;

function direccionDeEntrada(destino: WalletTabKey): number {
  if (tabAnterior === destino) return ultimaDireccion;
  // Llegar de fuera de la wallet no desliza: no hay "pestaña anterior".
  ultimaDireccion =
    tabAnterior === null ? 0 : TAB_ORDER[destino] > TAB_ORDER[tabAnterior] ? 1 : -1;
  tabAnterior = destino;
  return ultimaDireccion;
}

export default function WalletSectionShell({
  activeTab,
  children,
}: {
  activeTab: WalletTabKey;
  children: React.ReactNode;
}) {
  const router = useRouter();

  // El inicializador corre una sola vez por montaje, que es justo una vez por
  // cambio de pestaña: cada ruta trae su propio componente de página.
  const [direction] = useState(() => direccionDeEntrada(activeTab));

  const handleWalletPullRefresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  return (
    <>
      <style jsx>{`
        .content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
      `}</style>

      <RefreshableArea
        onRefresh={handleWalletPullRefresh}
        indicatorTop="var(--wallet-header-bottom, calc(env(safe-area-inset-top) + 20px))"
      >
        {/* El recorte horizontal lo pone `.walletContent` del layout. */}
        <motion.div
          initial={{ x: direction > 0 ? "100%" : direction < 0 ? "-100%" : 0 }}
          animate={{ x: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
        >
          <section className="content">{children}</section>
        </motion.div>
      </RefreshableArea>
    </>
  );
}
