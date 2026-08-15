"use client";

/**
 * Fila de datos de una portada — la de un perfil y la de una comunidad.
 *
 * Tres columnas iguales, cada una con dos renglones y separadas por una línea
 * que se apaga en las puntas. Sin caja ni fondo: lo que ordena la fila es el
 * ritmo, no un contorno.
 *
 * Un dato puede venir de dos formas. Con cifra (`847` arriba, `seguidores`
 * abajo), donde el tamaño marca cuál es el dato y cuál la palabra que lo nombra;
 * o emparejado (`paired`), para el que no tiene cifra —"Comunidad" y "Privada"—,
 * donde los dos renglones van del mismo tamaño y se leen como una sola frase.
 */

export type StatItem = {
  /** Clave de React, no se muestra. */
  key: string;
  /** Renglón de arriba. */
  top: string;
  /** Renglón de abajo. */
  bottom: string;
  /**
   * Los dos renglones del mismo tamaño, para el dato que no tiene cifra. El
   * tamaño queda a medio camino entre la cifra y la palabra de sus vecinos, así
   * la columna no pesa ni más ni menos que las otras dos.
   */
  paired?: boolean;
  /** Solo si el dato lleva a algún lado; si no, es texto y no un botón. */
  onClick?: () => void;
  /**
   * Cómo se lee de corrido. Los dos renglones por separado no significan nada
   * en un lector de pantalla.
   */
  ariaLabel?: string;
};

export default function StatsRow({ items }: { items: StatItem[] }) {
  return (
    <div className="vb-stats">
      <style jsx global>{`
        /* Toda la fila esta dibujada a partir de --vb-stat-scale: las medidas de
           abajo son las de referencia y la escala las mueve todas a la vez. Asi
           crecer o encoger el modulo entero es cambiar un numero, y no ocho
           valores sueltos que se desacomodan entre si. */
        .vb-stats {
          --vb-stat-scale: 1.2;
          margin-top: calc(18px * var(--vb-stat-scale));
          width: 100%;
          max-width: calc(460px * var(--vb-stat-scale));
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .vb-stat {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 0;
          min-width: 0;
          padding: calc(2px * var(--vb-stat-scale)) calc(14px * var(--vb-stat-scale));
          border: none;
          background: transparent;
          font-family: inherit;
          text-align: center;
        }

        /* En un celular angosto la columna mide un tercio de la pantalla y el
           acolchado se come el espacio que necesita la palabra mas larga
           ("publicaciones"), que acabaria partida a la mitad. Se recorta el
           acolchado, no la escala: el modulo se sigue viendo del tamano que
           debe. */
        @media (max-width: 430px) {
          .vb-stat {
            padding-inline: calc(4px * var(--vb-stat-scale));
          }
        }

        /* La linea que divide. Es un degradado que se apaga arriba y abajo, no
           un borde: un borde de 1px llega a ras de los dos extremos y corta la
           fila en cajas, que es de lo que se trataba salir. Va en el borde de
           inicio de cada dato menos el primero, con inset-inline-start para que
           en arabe se dibuje del lado que toca. */
        .vb-stat + .vb-stat::before {
          content: "";
          position: absolute;
          inset-inline-start: 0;
          top: calc(2px * var(--vb-stat-scale));
          width: 1px;
          height: calc(40px * var(--vb-stat-scale));
          background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.46) 22%,
            rgba(255, 255, 255, 0.46) 78%,
            rgba(255, 255, 255, 0) 100%
          );
        }

        .vb-stat-line {
          display: flex;
          align-items: center;
          justify-content: center;
          max-width: 100%;
          color: #fff;
          overflow-wrap: anywhere;
        }

        /* Solo el PRIMER renglon lleva altura fija, y es lo que sostiene la
           fila: en el dato emparejado los dos renglones son del mismo tamano y
           en los otros el de arriba es la cifra, asi que sin esto el segundo
           renglon empezaria a distinta altura en cada columna. Fijando el de
           arriba, el de abajo arranca parejo en las tres y va pegado, sin el
           hueco que dejaba darle altura fija tambien a el. */
        .vb-stat-line:first-child {
          min-height: calc(20px * var(--vb-stat-scale));
        }

        .vb-stat-value {
          font-size: calc(17px * var(--vb-stat-scale));
          font-weight: 600;
          line-height: 1.15;
          letter-spacing: -0.015em;
          font-variant-numeric: tabular-nums;
        }

        .vb-stat-word {
          font-size: calc(11px * var(--vb-stat-scale));
          font-weight: 500;
          line-height: 1.2;
          letter-spacing: 0.015em;
        }

        /* Mas chico que la cifra de sus vecinas y apenas por encima de la
           palabra: es un dato de texto, no una cantidad, y al tamano de una
           cifra pesaba mas que las dos columnas que si la tienen. */
        .vb-stat-pair {
          font-size: calc(12px * var(--vb-stat-scale));
          font-weight: 600;
          line-height: 1.2;
          letter-spacing: -0.005em;
        }

        /* Los datos se ven todos igual de blancos, asi que el que se puede
           pulsar necesita decirlo al pasar el cursor. Se tine de morado claro,
           no se subraya ni se enciende un fondo. */
        .vb-stat-button {
          cursor: pointer;
        }

        .vb-stat-button .vb-stat-line {
          transition: color 160ms ease;
        }

        .vb-stat-button:hover .vb-stat-line {
          color: #d8b4fe;
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-stat-button .vb-stat-line {
            transition: none;
          }
        }
      `}</style>

      {items.map((item) => {
        const topClass = item.paired ? "vb-stat-pair" : "vb-stat-value";
        const bottomClass = item.paired ? "vb-stat-pair" : "vb-stat-word";
        const lines = (
          <>
            <span className={`vb-stat-line ${topClass}`}>{item.top}</span>
            <span className={`vb-stat-line ${bottomClass}`}>{item.bottom}</span>
          </>
        );

        return item.onClick ? (
          <button
            key={item.key}
            type="button"
            className="vb-stat vb-stat-button"
            onClick={item.onClick}
            aria-label={item.ariaLabel}
          >
            {lines}
          </button>
        ) : (
          <div key={item.key} className="vb-stat">
            {lines}
          </div>
        );
      })}
    </div>
  );
}
