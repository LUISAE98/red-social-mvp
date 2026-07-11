"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GlobeMethods } from "react-globe.gl";
import {
  useWalletPurchaseGeo,
  type PurchaseGeoPoint,
} from "@/lib/wallet/walletPurchaseGeo";

type GlobeComponent = typeof import("react-globe.gl").default;

// Radio del punto morado según cuántas compras acumula esa celda.
function pointRadiusFor(purchases: number): number {
  return 0.3 + Math.min(purchases, 25) / 25 * 0.55;
}

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

const GLOBE_H = 440;

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${Math.round(value)}`;
  }
}

function darkTexture(): string | null {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#161235";
  ctx.fillRect(0, 0, 8, 8);
  return c.toDataURL();
}

/**
 * Globo 3D interactivo (mock): concentración aproximada de compras por región.
 * Versión simple con react-globe.gl. El usuario rota y hace zoom.
 */
export default function WalletPurchaseGlobe({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { points } = useWalletPurchaseGeo(uid);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  const [Globe, setGlobe] = useState<GlobeComponent | null>(null);
  const [width, setWidth] = useState(0);
  const [countries, setCountries] = useState<object[]>([]);
  const [img] = useState<string | null>(() =>
    typeof document === "undefined" ? null : darkTexture()
  );

  // Carga client-only del componente.
  useEffect(() => {
    let cancelled = false;
    import("react-globe.gl").then((m) => {
      if (!cancelled) setGlobe(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ancho del contenedor.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Continentes (capa base gris).
  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((d: { features?: object[] }) => {
        if (!cancelled) setCountries(d.features ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Controles: sin autorrotación, zoom, punto de vista inicial.
  useEffect(() => {
    const g = globeRef.current;
    if (!g || width === 0) return;
    try {
      const controls = g.controls() as {
        autoRotate: boolean;
        enableZoom: boolean;
        minDistance: number;
        maxDistance: number;
      };
      controls.autoRotate = false;
      // Tamaño fijo: sin zoom (no se puede agrandar/achicar). Solo rotar.
      controls.enableZoom = false;
      // Altitud menor = planeta más grande. En laptop ~20% más grande que en celular.
      const isLaptop = typeof window !== "undefined" && window.innerWidth >= 1024;
      g.pointOfView({ lat: 14, lng: -80, altitude: isLaptop ? 1.54 : 1.85 }, 0);
    } catch {
      // aún no listo
    }
  }, [Globe, width]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 44 }}>
      <style jsx>{`
        .globeFrame {
          width: 100%;
        }
        /* En celular el globo se sale a ancho completo, por encima de los
           márgenes laterales de la wallet, para que no lo corten. */
        @media (max-width: 640px) {
          .globeFrame {
            width: 100vw;
            margin-left: calc(50% - 50vw);
          }
        }
      `}</style>
      <span
        style={{
          fontSize: 16.5,
          fontWeight: 600,
          color: "#fff",
          letterSpacing: "-0.01em",
          textAlign: "center",
        }}
      >
        {tWallet("globeTitle")}
      </span>

      <div
        ref={wrapRef}
        className="globeFrame"
        style={{ height: GLOBE_H, overflow: "hidden", marginBottom: 8 }}
      >
        {Globe && width > 0 ? (
          <Globe
            ref={globeRef}
            width={width}
            height={GLOBE_H}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl={img ?? undefined}
            atmosphereColor="#a855ff"
            atmosphereAltitude={0.16}
            hexPolygonsData={countries}
            hexPolygonResolution={3}
            hexPolygonMargin={0.4}
            hexPolygonColor={() => "rgba(255,255,255,0.22)"}
            pointsData={points}
            pointLat={(d) => (d as PurchaseGeoPoint).lat}
            pointLng={(d) => (d as PurchaseGeoPoint).lng}
            pointColor={() => "#a855ff"}
            pointAltitude={0.01}
            pointRadius={(d) => pointRadiusFor((d as PurchaseGeoPoint).purchases)}
            pointsMerge={false}
            pointLabel={(d) => {
              const p = d as PurchaseGeoPoint;
              const label = p.city ?? p.country ?? tWallet("globeApproxLocation");
              return `
                <div style="background:rgba(20,14,40,0.96);border:1px solid rgba(168,85,255,0.4);border-radius:10px;padding:8px 11px;font-family:inherit;text-align:left;white-space:nowrap;">
                  <div style="font-size:12.5px;font-weight:700;color:#fff;margin-bottom:2px;">${label}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.7);">${tWallet("globeTooltipPurchases", { count: p.purchases })}</div>
                  <div style="font-size:11px;color:#c4a3ff;">${tWallet("globeTooltipGross", { amount: formatMoney(p.grossSum) })}</div>
                </div>`;
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
