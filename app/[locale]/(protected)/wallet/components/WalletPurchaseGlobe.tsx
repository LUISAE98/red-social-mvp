"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GlobeMethods } from "react-globe.gl";

type GlobeComponent = typeof import("react-globe.gl").default;

type PurchasePoint = {
  region: string;
  lat: number;
  lng: number;
  purchases: number;
  grossApprox: number;
};

// Datos MOCK agregados por país/región (aún no conectados a IP real).
const MOCK_POINTS: PurchasePoint[] = [
  { region: "México", lat: 23.6, lng: -102.5, purchases: 128, grossApprox: 24000 },
  { region: "Estados Unidos", lat: 39.8, lng: -98.6, purchases: 86, grossApprox: 15800 },
  { region: "Colombia", lat: 4.6, lng: -74.1, purchases: 54, grossApprox: 8200 },
  { region: "Brasil", lat: -14.2, lng: -51.9, purchases: 33, grossApprox: 4900 },
  { region: "Argentina", lat: -38.4, lng: -63.6, purchases: 41, grossApprox: 6100 },
  { region: "España", lat: 40.4, lng: -3.7, purchases: 37, grossApprox: 7300 },
  { region: "Chile", lat: -35.7, lng: -71.5, purchases: 22, grossApprox: 3400 },
  { region: "Perú", lat: -9.2, lng: -75, purchases: 19, grossApprox: 2600 },
  { region: "Guatemala", lat: 15.8, lng: -90.2, purchases: 12, grossApprox: 1500 },
  { region: "Ecuador", lat: -1.8, lng: -78.2, purchases: 9, grossApprox: 1100 },
  { region: "Canadá", lat: 56.1, lng: -106.3, purchases: 7, grossApprox: 1300 },
  { region: "Reino Unido", lat: 55.4, lng: -3.4, purchases: 6, grossApprox: 1200 },
];

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

// Hueco reservado en la página (chico) vs. lienzo 3D real (grande). El canvas
// desborda arriba/abajo para que al hacer zoom el planeta se salga de su marco.
const SLOT_H = 360;
const CANVAS_H = 780;

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

/**
 * Globo 3D interactivo (mock) con la concentración aproximada de compras por
 * país/región. Puntos grises base (continentes) + puntos morados con compras.
 * El usuario rota y hace zoom; no hay autorrotación.
 */
export default function WalletPurchaseGlobe() {
  const tWallet = useTranslations("wallet");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  const [Globe, setGlobe] = useState<GlobeComponent | null>(null);
  const [width, setWidth] = useState(0);
  const [countries, setCountries] = useState<object[]>([]);

  // Textura sólida oscura para el planeta (evita depender de globeMaterial()).
  const [globeImg] = useState<string | null>(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#0b0820";
    ctx.fillRect(0, 0, 8, 8);
    return c.toDataURL();
  });

  // Carga client-only del componente (evita SSR con window undefined).
  useEffect(() => {
    let cancelled = false;
    import("react-globe.gl").then((m) => {
      if (!cancelled) setGlobe(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ancho responsivo del contenedor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Continentes (capa base gris) desde un GeoJSON público.
  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((d: { features?: object[] }) => {
        if (!cancelled) setCountries(d.features ?? []);
      })
      .catch(() => {
        // Si falla, el globo se ve con el planeta oscuro + puntos morados.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Configura controles (sin autorrotación), zoom y punto de vista inicial.
  useEffect(() => {
    const g = globeRef.current;
    if (!g || width === 0) return;
    try {
      const controls = g.controls() as {
        autoRotate: boolean;
        enableZoom: boolean;
        minDistance: number;
        maxDistance: number;
        rotateSpeed: number;
      };
      controls.autoRotate = false;
      controls.enableZoom = true;
      controls.minDistance = 180;
      controls.maxDistance = 520;
      controls.rotateSpeed = 0.6;

      // Arranca en el zoom mínimo (más lejos = maxDistance ≈ altitud 4.2).
      g.pointOfView({ lat: 14, lng: -80, altitude: 4.2 }, 0);
    } catch {
      // El globo aún no está listo; se reintenta al cambiar Globe/width.
    }
  }, [Globe, width]);

  // Habilita rotar/zoom SOLO cuando el puntero está sobre la esfera; en el área
  // vacía del lienzo se liberan los controles (la página puede hacer scroll).
  // Usa toGlobeCoords() de globe.gl (null si el punto no toca el planeta), así
  // no importamos three (evita conflicto de doble instancia que rompe el render).
  useEffect(() => {
    const g = globeRef.current;
    if (!g || width === 0) return;
    let canvas: HTMLCanvasElement;
    let controls: { enabled: boolean };
    const gg = g as unknown as {
      renderer: () => { domElement: HTMLCanvasElement };
      toGlobeCoords: (x: number, y: number) => { lat: number; lng: number } | null;
    };
    try {
      canvas = gg.renderer().domElement;
      controls = g.controls() as { enabled: boolean };
    } catch {
      return;
    }
    if (!canvas || !controls || typeof gg.toGlobeCoords !== "function") return;

    const overGlobe = (clientX: number, clientY: number): boolean => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return gg.toGlobeCoords(clientX - rect.left, clientY - rect.top) != null;
    };

    const apply = (over: boolean) => {
      controls.enabled = over;
      canvas.style.touchAction = over ? "none" : "pan-y";
      canvas.style.cursor = over ? "grab" : "default";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return; // no alterar durante un arrastre
      apply(overGlobe(e.clientX, e.clientY));
    };
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) apply(overGlobe(t.clientX, t.clientY));
    };

    apply(false); // por defecto: fuera del planeta

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("touchstart", onTouchStart);
    };
  }, [Globe, width]);

  const pointLabel = (d: object): string => {
    const p = d as PurchasePoint;
    return `
      <div style="
        background: rgba(20,14,40,0.96);
        border: 1px solid rgba(168,85,255,0.4);
        border-radius: 10px;
        padding: 8px 11px;
        font-family: inherit;
        text-align: left;
        white-space: nowrap;
      ">
        <div style="font-size:12.5px;font-weight:700;color:#fff;margin-bottom:2px;">${p.region}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);">${tWallet("globeTooltipPurchases", { count: p.purchases })}</div>
        <div style="font-size:11px;color:#c4a3ff;">${tWallet("globeTooltipGross", { amount: formatMoney(p.grossApprox) })}</div>
      </div>
    `;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: SLOT_H,
          overflow: "visible",
          zIndex: 5,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: (SLOT_H - CANVAS_H) / 2,
            height: CANVAS_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
        {Globe && width > 0 ? (
          <Globe
            ref={globeRef}
            width={width}
            height={CANVAS_H}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl={globeImg ?? undefined}
            atmosphereColor="#a855ff"
            atmosphereAltitude={0.16}
            hexPolygonsData={countries}
            hexPolygonResolution={4}
            hexPolygonMargin={0.32}
            hexPolygonColor={() => "rgba(255,255,255,0.22)"}
            pointsData={MOCK_POINTS}
            pointLat={(d) => (d as PurchasePoint).lat}
            pointLng={(d) => (d as PurchasePoint).lng}
            pointColor={() => "#a855ff"}
            pointAltitude={0}
            pointRadius={0.35}
            pointsMerge={false}
            pointLabel={pointLabel}
          />
        ) : (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
            {tWallet("globeLoading")}
          </div>
        )}
        </div>
      </div>

      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
        {tWallet("globeCaption")}
      </span>
    </div>
  );
}
