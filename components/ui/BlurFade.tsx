"use client";

import type { CSSProperties } from "react";

/**
 * Desenfoque progresivo, para cabeceras y pies que flotan sobre contenido que
 * scrollea por detrás.
 *
 * NO es un `backdrop-filter` normal. Uno solo tiene canto duro —de un lado
 * borroso, del otro nítido, con la línea a la vista— y lo que se busca aquí es
 * que el contenido se DISUELVA al pasar por debajo, sin ninguna arista.
 *
 * Se consigue apilando cuatro capas de desenfoque, cada una el doble que la
 * anterior y cada una recortada con su propia máscara en degradado, todas
 * ancladas al borde fuerte. Donde se solapan las cuatro, el desenfoque es
 * máximo; hacia el otro extremo van desapareciendo una a una y no queda nada.
 * Como cada máscara es un degradado suave y no una banda, no hay costura entre
 * capas: la transición es continua.
 *
 * Encima va un velo del mismo color del fondo, también en degradado, porque el
 * desenfoque solo emborrona —no oscurece— y el texto de la cabecera tiene que
 * seguir leyéndose cuando pasa por debajo un globo claro.
 *
 * Sin `backdrop-filter` (navegador viejo) queda solo el velo, que ya es una
 * degradación digna: se ve un fundido al color del fondo en vez de un corte.
 * Por eso aquí no hace falta ningún `@supports`.
 */

/** Cuatro. Con tres se nota el salto entre capas y con cinco no se gana nada. */
const LAYERS = 4;

export type BlurFadeProps = {
  /** Borde donde el efecto es MÁS fuerte. Una cabecera quiere `top`. */
  side?: "top" | "bottom";
  /**
   * Alto de la zona del efecto. Un número son px; también acepta una medida CSS
   * ("100%"), que es lo que quiere quien solo busca cristal uniforme y no un
   * fundido — ahí no hay que medir nada.
   */
  size: number | string;
  /**
   * Cristal PAREJO, sin degradado: misma potencia en toda la caja. Para piezas
   * que no tienen una orilla por la que disolverse, como la píldora del nav.
   *
   * Las capas siguen llevando su máscara (una que no recorta nada). No es
   * decorativo: es la configuración que se comprobó en Android, y quitarla
   * cambiaría la ruta de pintado.
   */
  uniform?: boolean;
  /** Desenfoque máximo, en el borde fuerte. */
  blur?: number;
  /**
   * Cuánto mide el FUNDIDO, en px, contando desde el borde limpio. Lo que quede
   * más allá se mantiene a plena potencia.
   *
   * Es el número con el que se piensa al colocarlo: "que el desvanecido dure
   * 40px". Así el texto de la cabecera cae en la parte maciza y la disolución
   * ocurre por debajo de él. Por defecto, toda la zona.
   */
  fade?: number;
  /**
   * Color del velo en el borde fuerte. Debe ser el del fondo de la caja.
   *
   * La opacidad es la perilla del efecto: por encima de ~0,8 deja de leerse como
   * cristal y se lee como una tapa. Sobre fondos muy oscuros hay que bajarla más
   * todavía, porque ahí el velo casi no se distingue del propio fondo.
   */
  veil?: string;
  /**
   * Saturación del fondo difuminado. Con un velo por encima solo atraviesa una
   * parte del color de detrás, así que hay que exagerarlo para que se note.
   */
  saturate?: number;
  style?: CSSProperties;
};

export default function BlurFade({
  side = "top",
  size,
  blur = 14,
  fade,
  uniform = false,
  veil = "rgba(11,11,13,0.68)",
  saturate = 140,
  style,
}: BlurFadeProps) {
  // `to top` pone el 0% ABAJO y el 100% arriba, que es justo lo que se quiere
  // para una cabecera: el 0% es el extremo limpio y el 100% el fuerte.
  const axis = side === "top" ? "to top" : "to bottom";

  /**
   * Posición, en el eje del degradado, de una fracción del recorrido — 0 es el
   * borde limpio y 1 el fuerte. Todo el recorrido se comprime dentro de `fade`,
   * y de ahí al borde fuerte se queda a tope.
   */
  // Con `size` en medida CSS no hay proporción que calcular; ese caso es
  // siempre uniforme.
  const isNumeric = typeof size === "number";
  const parejo = uniform || !isNumeric;
  const span =
    parejo || fade == null || !isNumeric
      ? 1
      : Math.min(Math.max(fade / size, 0.05), 1);
  const at = (t: number) => `${(t * span * 100).toFixed(2)}%`;

  const box: CSSProperties = {
    position: "absolute",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    // Explícito y no por clave calculada: `{[side]: 0}` se ensancha a un índice
    // de string y deja de encajar en `CSSProperties`.
    top: side === "top" ? 0 : undefined,
    bottom: side === "bottom" ? 0 : undefined,
    height: size,
    // Nunca se come un clic: lo que hay debajo sigue siendo pulsable, y la
    // cabecera que la contiene pinta su contenido por encima.
    pointerEvents: "none",
  };

  return (
    <div aria-hidden style={{ ...box, zIndex: 0, ...style }}>
      {Array.from({ length: LAYERS }, (_, i) => {
        // La primera capa es la más suave y la que más terreno cubre; cada
        // siguiente dobla el desenfoque y se arrima más al borde fuerte.
        const strength = blur / 2 ** (LAYERS - 1 - i);
        // Parejo: máscara que deja pasar TODO. Se mantiene la máscara aunque no
        // recorte, para no cambiar la ruta de pintado (ver `uniform`).
        const mask = parejo
          ? "linear-gradient(#000, #000)"
          : `linear-gradient(${axis}, transparent ${at(i / LAYERS)}, #000 ${at(1)})`;
        return (
          <div
            key={i}
            style={{
              ...box,
              backdropFilter: `blur(${strength}px) saturate(${saturate}%)`,
              WebkitBackdropFilter: `blur(${strength}px) saturate(${saturate}%)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}

      {/* El velo va el último, encima de todo el desenfoque. */}
      <div
        style={{
          ...box,
          background: parejo
            ? veil
            : `linear-gradient(${axis}, transparent 0%, ${veil} ${at(1)})`,
        }}
      />
    </div>
  );
}
