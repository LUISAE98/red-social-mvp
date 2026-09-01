"use client";

// El hueco del feed mientras carga.
//
// Sustituye al spinner que habia antes. `vibra_style.md` lo pide asi de forma
// explicita —"mostrar el esqueleto mientras carga, sin spinner ni texto de
// cargando"— y no es capricho: un spinner no dice cuanto falta ni que va a
// aparecer, y en una pantalla negra entera se lee como que algo se atasco. El
// esqueleto ya tiene la forma de lo que viene, asi que la espera se nota menos
// aunque dure lo mismo.
//
// Dos formas, las mismas dos del feed: el reel a pantalla completa del movil y
// el carrusel de tres paneles del escritorio.

import { SkeletonBlock } from "@/components/ui";

/** El reel de celular: un panel que ocupa la pantalla. */
function ReelPanelSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#0a0a0a",
        overflow: "hidden",
      }}
    >
      {/* Cabecera: la cara y el nombre de quien grabo. */}
      <div
        style={{
          position: "absolute",
          // No existe un `--vb-safe-top` en la plataforma: el reel real recibe su
        // margen superior por prop. Aqui basta un valor fijo del mismo orden,
        // que es donde va a caer la cabecera cuando llegue.
        top: 52,
          insetInlineStart: 12,
          display: "flex",
          alignItems: "center",
          gap: compact ? 6 : 8,
        }}
      >
        <SkeletonBlock width={compact ? 34 : 44} height={compact ? 34 : 44} circle />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SkeletonBlock width={compact ? 84 : 116} height={compact ? 13 : 15} radius={5} />
          <SkeletonBlock width={compact ? 52 : 68} height={compact ? 10 : 12} radius={5} />
        </div>
      </div>

      {/* Pie: el contexto y los botones. Ocupan el mismo sitio que ocuparan. */}
      <div
        style={{
          position: "absolute",
          insetInline: 12,
          bottom: "calc(var(--vb-safe-bottom, 0px) + 84px)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <SkeletonBlock width={110} height={compact ? 22 : 26} radius={999} />
        <div style={{ display: "flex", gap: 8 }}>
          <SkeletonBlock height={compact ? 31 : 41} radius={10} style={{ flex: 1 }} />
          <SkeletonBlock height={compact ? 31 : 41} radius={10} style={{ flex: 1 }} />
        </div>
      </div>
    </div>
  );
}

/** El carrusel de escritorio: el panel central y sus dos vecinos asomando. */
function CarouselSkeleton() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
      }}
    >
      {[0.72, 1, 0.72].map((escala, i) => (
        <div
          key={i}
          style={{
            position: "relative",
            height: `min(${78 * escala}vh, ${620 * escala}px)`,
            aspectRatio: "9 / 16",
            borderRadius: 18,
            overflow: "hidden",
            // Los vecinos van apagados, igual que en el carrusel de verdad.
            opacity: escala === 1 ? 1 : 0.45,
          }}
        >
          <ReelPanelSkeleton compact={escala !== 1} />
        </div>
      ))}
    </div>
  );
}

export default function ReelSkeleton({ desktop = false }: { desktop?: boolean }) {
  if (desktop) return <CarouselSkeleton />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <ReelPanelSkeleton />
    </div>
  );
}
