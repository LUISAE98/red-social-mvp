"use client";

// Globo 3D decorativo del onboarding: mismo motor que el de la wallet
// (react-globe.gl), en blanco. Los "puntos" verdes son celdas de la rejilla de
// hexágonos coloreadas (misma capa/estilo que los continentes), concentradas en
// el continente americano.

import { useEffect, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";

type GlobeComponent = typeof import("react-globe.gl").default;

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

const HEX_RES = 3;

// Textura base del globo: gris-lavanda muy claro para que los continentes
// contrasten sobre una esfera clara.
function lightTexture(): string | null {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#d7d7e6";
  ctx.fillRect(0, 0, 8, 8);
  return c.toDataURL();
}

export default function WalletOnboardingGlobe() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [Globe, setGlobe] = useState<GlobeComponent | null>(null);
  const [size, setSize] = useState(0);
  const [countries, setCountries] = useState<object[]>([]);
  const [img] = useState<string | null>(() =>
    typeof document === "undefined" ? null : lightTexture()
  );

  // Carga client-only de la librería.
  useEffect(() => {
    let cancelled = false;
    import("react-globe.gl").then((m) => {
      if (!cancelled) setGlobe(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // El globo llena el ancho de su contenedor (cuadrado).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Continentes (rejilla de hexágonos).
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

  // Controles: autorrotación suave, solo rotar (sin zoom ni pan).
  useEffect(() => {
    const g = globeRef.current;
    if (!g || size === 0) return;
    try {
      const controls = g.controls() as {
        autoRotate: boolean;
        autoRotateSpeed: number;
        enableZoom: boolean;
        enablePan: boolean;
      };
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      controls.enableZoom = false;
      controls.enablePan = false;
      g.pointOfView({ lat: 14, lng: -80, altitude: 2.2 }, 0);
    } catch {
      // aún no listo
    }
  }, [Globe, size]);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: size }} aria-hidden="true">
      {Globe && size > 0 ? (
        <Globe
          ref={globeRef}
          width={size}
          height={size}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={img ?? undefined}
          atmosphereColor="#ffffff"
          atmosphereAltitude={0.18}
          hexPolygonsData={countries}
          hexPolygonResolution={HEX_RES}
          hexPolygonMargin={0.4}
          hexPolygonColor={() => "#22c55e"}
        />
      ) : null}
    </div>
  );
}
