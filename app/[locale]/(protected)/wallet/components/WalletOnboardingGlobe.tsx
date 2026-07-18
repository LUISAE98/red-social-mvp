"use client";

// Globo 3D decorativo del onboarding: mismo motor que el de la wallet
// (react-globe.gl), en blanco. Los "puntos" verdes NO son países coloreados,
// sino celdas H3 individuales sembradas al azar sobre tierra, separadas entre sí
// y concentradas mayormente en el continente americano.

import { useEffect, useRef, useState } from "react";
import { latLngToCell, gridDisk } from "h3-js";
import type { GlobeMethods } from "react-globe.gl";

type GlobeComponent = typeof import("react-globe.gl").default;
type LngLat = [number, number];

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

// Resolución H3 = la misma que hexPolygonResolution (para que calce con la rejilla).
const HEX_RES = 3;
// Cantidad total de puntos verdes y proporción en América.
const GREEN_TARGET = 66;
const AMERICAS_SHARE = 0.68;

// Textura base del globo: gris-lavanda muy claro para que los continentes
// (blancos) contrasten sobre una esfera clara.
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

// Anillos exteriores de una geometría (ignora huecos).
function outerRings(geom: unknown): LngLat[][] {
  const g = geom as { type?: string; coordinates?: unknown };
  if (g?.type === "Polygon") return [(g.coordinates as LngLat[][])[0]];
  if (g?.type === "MultiPolygon")
    return (g.coordinates as LngLat[][][]).map((poly) => poly[0]);
  return [];
}

// ¿El punto (lng,lat) cae dentro del anillo? Ray casting.
function inRing(x: number, y: number, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

type LandRing = {
  ring: LngLat[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export default function WalletOnboardingGlobe() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [Globe, setGlobe] = useState<GlobeComponent | null>(null);
  const [size, setSize] = useState(0);
  // Continentes (hexágonos blancos) + puntos verdes (capa pointsData, fiable:
  // un punto por coordenada, sin teselación ni problemas de relleno de polígono).
  const [countries, setCountries] = useState<object[]>([]);
  const [greenPoints, setGreenPoints] = useState<{ lat: number; lng: number }[]>(
    []
  );
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

  // Continentes (blancos) + puntos verdes dispersos sobre tierra.
  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((d: { features?: object[] }) => {
        if (cancelled) return;
        const feats = d.features ?? [];

        // Anillos de tierra con bounding box (para descartar océano rápido).
        const land: LandRing[] = [];
        for (const f of feats) {
          for (const ring of outerRings((f as { geometry?: unknown }).geometry)) {
            if (!Array.isArray(ring) || ring.length < 4) continue;
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const p of ring) {
              if (p[0] < minX) minX = p[0];
              if (p[0] > maxX) maxX = p[0];
              if (p[1] < minY) minY = p[1];
              if (p[1] > maxY) maxY = p[1];
            }
            land.push({ ring, minX, minY, maxX, maxY });
          }
        }
        const onLand = (lng: number, lat: number) =>
          land.some(
            (L) =>
              lng >= L.minX &&
              lng <= L.maxX &&
              lat >= L.minY &&
              lat <= L.maxY &&
              inRing(lng, lat, L.ring)
          );

        // Siembra por cupos fijos (no por probabilidad, que se sesga por la
        // cantidad de océano de cada banda): primero el cupo de América, luego el
        // resto. Solo sobre tierra, en celdas H3 distintas y no vecinas (gridDisk)
        // para que los puntos queden separados y no se agrupen.
        const used = new Set<string>();
        const green: { lat: number; lng: number }[] = [];
        const seed = (count: number, lngFn: () => number) => {
          const maxTries = count * 800;
          let placed = 0;
          for (let t = 0; t < maxTries && placed < count; t++) {
            const lng = lngFn();
            const lat = -48 + Math.random() * 103; // -48..55
            if (!onLand(lng, lat)) continue;
            const cell = latLngToCell(lat, lng, HEX_RES);
            if (used.has(cell)) continue;
            if (gridDisk(cell, 1).some((c) => used.has(c))) continue;
            used.add(cell);
            green.push({ lat, lng });
            placed++;
          }
        };

        const amTarget = Math.round(GREEN_TARGET * AMERICAS_SHARE);
        // América: longitud -168..-32.
        seed(amTarget, () => -168 + Math.random() * 136);
        // Resto: Europa/África (-20..45) o Asia/Oceanía (60..180).
        seed(GREEN_TARGET - amTarget, () =>
          Math.random() < 0.5 ? -20 + Math.random() * 65 : 60 + Math.random() * 120
        );

        setCountries(feats);
        setGreenPoints(green);
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
          hexPolygonColor={() => "rgba(255,255,255,0.9)"}
          pointsData={greenPoints}
          pointLat={(d) => (d as { lat: number }).lat}
          pointLng={(d) => (d as { lng: number }).lng}
          pointColor={() => "#22c55e"}
          pointAltitude={0}
          pointRadius={0.4}
          pointResolution={16}
          pointsMerge={false}
        />
      ) : null}
    </div>
  );
}
