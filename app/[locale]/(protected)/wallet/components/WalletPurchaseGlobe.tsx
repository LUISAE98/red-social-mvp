"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";
import type { GlobeMethods } from "react-globe.gl";
import { useWalletPurchaseGeo } from "@/lib/wallet/walletPurchaseGeo";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

type GlobeComponent = typeof import("react-globe.gl").default;

// Propiedades que marcan un hexágono como "compra" (morado) dentro de la
// misma capa hexPolygons que los grises.
type PurchaseFeatureProps = {
  __purchase: true;
  city: string | null;
  country: string | null;
  purchases: number;
  grossSum: number;
};

// Resolución H3 = la misma que hexPolygonResolution (para que calce con la rejilla gris).
const HEX_RES = 3;

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

const MOBILE_H = 440;
const LAPTOP_H = 580;
// Ancho de contenedor a partir del cual tratamos la vista como laptop (globo más
// grande + marco más alto, usando la MISMA señal para que nunca se corte).
const LAPTOP_MIN_WIDTH = 820;

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
 * Versión simple con react-globe.gl. Tamaño fijo: el usuario solo rota.
 */
export default function WalletPurchaseGlobe({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { format: formatMoney } = usePriceFormat();
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

  // Controles: sin autorrotación ni zoom; solo rotar.
  useEffect(() => {
    const g = globeRef.current;
    if (!g || width === 0) return;
    try {
      const controls = g.controls() as {
        autoRotate: boolean;
        enableZoom: boolean;
        enablePan: boolean;
        minDistance: number;
        maxDistance: number;
      };
      controls.autoRotate = false;
      // Tamaño fijo: sin zoom ni pan; el globo solo se puede rotar.
      controls.enableZoom = false;
      controls.enablePan = false;
      // Misma altitud siempre (deja margen → nunca se corta). El globo se ve más
      // grande en laptop porque el marco es más alto (crece en píxeles con el alto).
      g.pointOfView({ lat: 14, lng: -80, altitude: 1.85 }, 0);
    } catch {
      // aún no listo
    }
  }, [Globe, width]);

  // Marco más alto en laptop para que el globo (más grande) no se corte.
  const frameH = width >= LAPTOP_MIN_WIDTH ? LAPTOP_H : MOBILE_H;

  // Una sola capa de hexágonos: países (grises) + compras (moradas, mismo plano).
  // Cada compra se mapea a su celda H3 (misma rejilla que los grises); si varias
  // caen en la misma celda, se acumulan en un solo hexágono morado.
  // Además genero un punto invisible por celda (blanco de hover para el tooltip).
  const { hexData, hoverPoints } = useMemo(() => {
    const byCell = new Map<
      string,
      { city: string | null; country: string | null; purchases: number; grossSum: number }
    >();
    for (const p of points) {
      const cell = latLngToCell(p.lat, p.lng, HEX_RES);
      const cur = byCell.get(cell) ?? {
        city: p.city,
        country: p.country,
        purchases: 0,
        grossSum: 0,
      };
      cur.purchases += p.purchases;
      cur.grossSum += p.grossSum;
      byCell.set(cell, cur);
    }
    const hexData: object[] = [...countries];
    const hoverPoints: Array<
      { lat: number; lng: number } & PurchaseFeatureProps
    > = [];
    for (const [cell, v] of byCell) {
      hexData.push({
        type: "Feature",
        properties: { __purchase: true, ...v } satisfies PurchaseFeatureProps,
        geometry: {
          type: "Polygon",
          coordinates: [cellToBoundary(cell, true)],
        },
      });
      const [lat, lng] = cellToLatLng(cell);
      hoverPoints.push({ lat, lng, __purchase: true, ...v });
    }
    return { hexData, hoverPoints };
  }, [countries, points]);

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
      {/* Quita el fondo negro del tooltip propio de react-globe.gl (float-tooltip). */}
      <style jsx global>{`
        .float-tooltip-kap {
          background: transparent !important;
          padding: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
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
        style={{ height: frameH, overflow: "hidden", marginBottom: 8 }}
      >
        {Globe && width > 0 ? (
          <Globe
            ref={globeRef}
            width={width}
            height={frameH}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl={img ?? undefined}
            atmosphereColor="#a855ff"
            atmosphereAltitude={0.16}
            hexPolygonsData={hexData}
            hexPolygonResolution={3}
            hexPolygonMargin={0.4}
            hexPolygonColor={(d) => {
              const f = d as { properties?: { __purchase?: boolean } };
              return f.properties?.__purchase ? "#a855ff" : "rgba(255,255,255,0.22)";
            }}
            pointsData={hoverPoints}
            pointLat={(d) => (d as { lat: number }).lat}
            pointLng={(d) => (d as { lng: number }).lng}
            pointColor={() => "rgba(0,0,0,0)"}
            pointAltitude={0.02}
            pointRadius={0.6}
            pointsMerge={false}
            pointLabel={(d) => {
              const p = d as PurchaseFeatureProps;
              const parts: string[] = [];
              if (p.city) parts.push(p.city);
              if (p.country) parts.push(p.country);
              const label = parts.length ? parts.join(", ") : tWallet("globeApproxLocation");
              return `
                <div style="font-family:inherit;text-align:left;white-space:nowrap;">
                  <div style="font-size:12.5px;font-weight:700;color:#fff;margin-bottom:2px;">${label}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.85);">${tWallet("globeTooltipPurchases", { count: p.purchases })}</div>
                  <div style="font-size:11px;color:#c4a3ff;">${tWallet("globeTooltipGross", { amount: formatMoney(p.grossSum) })}</div>
                </div>`;
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
