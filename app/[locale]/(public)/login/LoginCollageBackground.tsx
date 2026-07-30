// Collage de imágenes de categorías/servicios con profundidad (perspectiva 3D)
// estilo Netflix, para el fondo del login. Es puramente decorativo.
//
// Ocupa la primera pantalla y se desvanece a negro hacia abajo, para que el
// contenido que va debajo (fuera de este componente) tenga lienzo limpio.

import { buildCollageTiles } from "@/lib/collage";

// El set completo (35 imágenes, sin repetir) y el orden que embaldosa viven en
// lib/collage, compartidos con el splash y el intro de la grabación.
export default function LoginCollageBackground() {
  const tiles = buildCollageTiles();

  return (
    <div className="login-collage-root" aria-hidden="true">
      <div className="login-collage-stage">
        <div className="login-collage-grid">
          {tiles.map((tile, i) => (
            <div
              key={i}
              className={`login-collage-tile${tile.wide ? " is-wide" : ""}${
                tile.flipMobile ? " is-flip-mobile" : ""
              }`}
            >
              {/* Decorativo: <img> ligero, no next/image (WebP ~20-40 KB). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/${tile.src}.webp`}
                alt=""
                loading="lazy"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="login-collage-overlay" />

      <style jsx>{`
        .login-collage-root {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          /* Cubre la primera pantalla y algo más; por debajo el body es negro. */
          height: 135vh;
          z-index: 0;
          overflow: hidden;
          background: #07030f;
          pointer-events: none;
        }

        .login-collage-stage {
          position: absolute;
          inset: -22%;
          perspective: 1400px;
          display: grid;
          place-items: center;
        }

        /* Laptop: 6 columnas. El set reciclado embaldosa sin huecos a 6 (y a 3 en
           celular); verificado — a 4, 5, 7 y 8 sí deja huecos. Sin \`dense\`:
           reacomodaría los tiles y rompería el embaldosado. */
        .login-collage-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          grid-auto-rows: auto;
          gap: 16px;
          width: 150vw;
          transform-origin: center;
          /* translateX: la rotación -11deg hunde la esquina superior derecha y
             dejaba ese lado descubierto, con la izquierda de sobra. Se corre el
             mosaico a la derecha para repartirlo. Va también en los keyframes:
             la animación reescribe el transform completo y si no lo lleva, al
             arrancar el drift el mosaico brincaría de vuelta al centro. */
          transform: translateX(9vw) rotateX(15deg) rotateZ(-11deg) scale(1.08);
          filter: saturate(1.02);
          animation: loginCollageDrift 46s ease-in-out infinite alternate;
        }

        .login-collage-tile {
          grid-column: span 1;
          aspect-ratio: 1 / 1;
          border-radius: 0;
          overflow: hidden;
          background: linear-gradient(160deg, #1b1530, #0d0a18);
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55);
        }

        /* Imágenes apaisadas: ocupan dos columnas, misma altura de fila. */
        .login-collage-tile.is-wide {
          grid-column: span 2;
          aspect-ratio: 2 / 1;
        }


        .login-collage-tile img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          opacity: 0.9;
        }

        /* Viñeta para legibilidad + desvanecido fuerte a negro en la base, para
           empalmar con el contenido que va debajo del fold. */
        .login-collage-overlay {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(
              135% 120% at 60% 45%,
              rgba(6, 3, 14, 0.4) 0%,
              rgba(5, 2, 11, 0.66) 55%,
              rgba(3, 1, 8, 0.86) 100%
            ),
            linear-gradient(
              180deg,
              rgba(5, 2, 11, 0.56) 0%,
              rgba(5, 2, 11, 0.28) 28%,
              rgba(3, 1, 8, 0.42) 62%,
              rgba(1, 0, 4, 0.88) 82%,
              #000 100%
            );
        }

        @keyframes loginCollageDrift {
          from {
            transform: translateX(9vw) rotateX(15deg) rotateZ(-11deg) scale(1.08)
              translateY(0);
          }
          to {
            transform: translateX(9vw) rotateX(15deg) rotateZ(-11deg) scale(1.08)
              translateY(-46px);
          }
        }

        /* Celular (vertical): 3 columnas → 14 filas, sin huecos. */
        @media (max-width: 900px) {
          .login-collage-root {
            height: 118vh;
          }

          /* El contenedor mide 118vh, así que el centro de la cuadrícula caía
             ~9vh por DEBAJO del centro de la pantalla y dejaba franja muerta
             arriba. Se sube ese desfase para centrarla en lo que se ve. */
          .login-collage-stage {
            transform: translateY(-9vh);
          }

          /* El ancho manda el zoom: con 3 columnas, cada tile mide ancho/3.
             148.5vw = 165vw - 10% → tiles 10% más chicos. Por debajo de ~130vw la
             cuadrícula se vuelve más angosta que lo que la rotación de -9deg
             necesita y reaparece el espacio muerto a la derecha.

             OJO: hay que cambiar también el nombre de la animación. Los keyframes
             reescriben el \`transform\` ENTERO y las animaciones pisan al transform
             base — con los de laptop, este \`transform\` de aquí abajo nunca se
             aplicaba y el celular acababa usando la rotación de laptop. */
          .login-collage-grid {
            grid-template-columns: repeat(3, 1fr);
            width: 148.5vw;
            gap: 10px;
            transform: translateX(8vw) rotateX(12deg) rotateZ(-9deg) scale(1.12);
            animation-name: loginCollageDriftMobile;
          }

          /* Espejo horizontal sólo en celular (ver \`flipMobile\` en lib/collage). */
          .login-collage-tile.is-flip-mobile img {
            transform: scaleX(-1);
          }
        }

        @keyframes loginCollageDriftMobile {
          from {
            transform: translateX(8vw) rotateX(12deg) rotateZ(-9deg) scale(1.12)
              translateY(0);
          }
          to {
            transform: translateX(8vw) rotateX(12deg) rotateZ(-9deg) scale(1.12)
              translateY(-46px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .login-collage-grid {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
