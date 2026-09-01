"use client";

import { useId } from "react";

/**
 * El aro del avatar de Vibra. Uno solo para toda la plataforma.
 *
 * Antes había ocho: perfil 6/4, carrusel de historias 4/3, `StoryCircle` 3/2,
 * `StoryCoverPicker` 2.5/2, `StoryRingAvatar` 2.4/1.5, Movimientos 2.4/2.5,
 * buscador 2.2 y top fans 2/1.5. Ocho sitios, ocho medidas, y se notaba.
 *
 * Se dibuja en SVG y no con máscaras CSS por dos razones concretas:
 *
 * 1. CIERRA. Una máscara cónica deja una muesca de antialiasing en el punto de
 *    partida y el círculo nunca termina de cerrarse. `stroke-dashoffset: 0` es
 *    un círculo entero, sin costura.
 * 2. NO DEPENDE DE `@property`. Animar una propiedad personalizada obliga a
 *    registrarla, y Tailwind v4 poda las reglas `@property` que no ve usadas.
 *    `stroke-dashoffset` es animable de serie desde siempre.
 */

/** Colores del aro. Los mismos que ya usaba cada sitio por su cuenta. */
const TRAZOS = {
  vibra: ["#ec4899", "#9333ea", "#3b82f6"],
  live: ["#ef4444", "#ef4444", "#ef4444"],
  apagado: ["rgba(255,255,255,0.28)", "rgba(255,255,255,0.28)", "rgba(255,255,255,0.28)"],
} as const;

export type VarianteAro = keyof typeof TRAZOS;

/**
 * Grosor y hueco, en proporción a la foto.
 *
 * Los números salen de medir los aros que ya se veían bien: el carrusel estaba
 * en 5,7 % y `StoryCircle` en 5,0 %. Los topes evitan los dos extremos que se
 * veían mal — un aro de un pelo en los avatares pequeños y una rosca demasiado
 * gorda en el avatar grande del perfil.
 */
const PROPORCION_GROSOR = 0.055;
const PROPORCION_HUECO = 0.04;
const GROSOR_MIN = 2;
const GROSOR_MAX = 6;
const HUECO_MIN = 1.5;
const HUECO_MAX = 4;

const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * La medida del aro para una foto de `foto` píxeles de diámetro.
 *
 * `sobresale` es cuánto ocupa el aro por fuera de la foto: lo necesita quien lo
 * pinta para dejarle aire y que no lo recorte un contenedor con `overflow`.
 */
export function medidaAro(foto: number) {
  const grosor = acotar(foto * PROPORCION_GROSOR, GROSOR_MIN, GROSOR_MAX);
  const hueco = acotar(foto * PROPORCION_HUECO, HUECO_MIN, HUECO_MAX);
  return { grosor, hueco, sobresale: grosor + hueco };
}

/**
 * La medida del aro cuando lo que está fijo es la CAJA, no la foto.
 *
 * Algunos avatares tienen que seguir midiendo lo mismo con aro y sin él, para
 * no descuadrar a quien los coloca: ahí la foto es la que cede el sitio. Como
 * el grosor depende de la foto y la foto del grosor, se resuelve iterando; con
 * tres vueltas ya no se mueve.
 */
export function medidaAroEnCaja(caja: number) {
  let foto = caja;
  for (let i = 0; i < 3; i++) foto = caja - 2 * medidaAro(foto).sobresale;
  return { foto, ...medidaAro(foto) };
}

export function AvatarRing({
  foto,
  variante = "vibra",
  color,
  progreso = 1,
  duracionMs = 0,
}: {
  /** Diámetro de la foto en píxeles. El aro va por fuera, sin comérsela. */
  foto: number;
  variante?: VarianteAro;
  /**
   * Color liso a medida, en vez de la variante.
   *
   * Lo necesita el live, donde el aro lleva el color del donativo o el rojo de
   * la transmisión. La geometría sigue siendo la misma; lo único que cambia es
   * el color.
   */
  color?: string;
  /** Cuánto lleva dibujado, de 0 a 1. A 1 el círculo está cerrado. */
  progreso?: number;
  /** Si es mayor que 0, el aro se dibuja barriendo en vez de aparecer entero. */
  duracionMs?: number;
}) {
  // Un id por instancia: dos degradados con el mismo id en la página se pisan y
  // el segundo aro saldría del color del primero.
  const idGrad = useId();
  const { grosor, hueco, sobresale } = medidaAro(foto);

  const lado = foto + sobresale * 2;
  // El trazo se pinta CENTRADO en el radio, así que el radio va a media línea.
  const radio = foto / 2 + hueco + grosor / 2;
  const vuelta = 2 * Math.PI * radio;
  const [a, b, c] = TRAZOS[variante];

  return (
    <svg
      aria-hidden="true"
      width={lado}
      height={lado}
      viewBox={`0 0 ${lado} ${lado}`}
      style={{
        position: "absolute",
        // Se centra sobre el contenedor en vez de anclarse con `inset` negativo.
        // Con `inset` solo caía bien si el contenedor medía EXACTAMENTE lo que
        // la foto; en cuanto era mayor —una caja fija con la foto centrada— el
        // aro se descolocaba hacia arriba y a la izquierda.
        left: "50%",
        top: "50%",
        // El giro deja el arranque a las 12 y no a las 3, que es el ángulo 0.
        transform: "translate(-50%, -50%) rotate(-90deg)",
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id={idGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={a} />
          <stop offset="52%" stopColor={b} />
          <stop offset="100%" stopColor={c} />
        </linearGradient>
      </defs>
      <circle
        cx={lado / 2}
        cy={lado / 2}
        r={radio}
        fill="none"
        stroke={color ?? `url(#${idGrad})`}
        strokeWidth={grosor}
        // A cero, una punta redonda deja un puntito suelto en algunos
        // navegadores. Sin aro no debe verse nada en absoluto.
        strokeLinecap={progreso > 0 ? "round" : "butt"}
        strokeDasharray={vuelta}
        strokeDashoffset={vuelta * (1 - acotar(progreso, 0, 1))}
        style={
          duracionMs > 0
            ? { transition: `stroke-dashoffset ${duracionMs}ms cubic-bezier(0.22, 1, 0.36, 1)` }
            : undefined
        }
      />
    </svg>
  );
}
