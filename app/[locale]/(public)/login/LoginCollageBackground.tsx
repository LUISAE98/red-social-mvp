"use client";

// Collage de imágenes de categorías/servicios con profundidad (perspectiva 3D)
// estilo Netflix, para el fondo del login. Es puramente decorativo.
//
// Ocupa la primera pantalla y se desvanece a negro hacia abajo, para que el
// contenido que va debajo (fuera de este componente) tenga lienzo limpio.

// Set curado de imágenes. `wide: true` → la imagen es apaisada y ocupa dos
// columnas de la cuadrícula.
type CollageImage = { src: string; wide: boolean };

const CATEGORY_IMAGES: CollageImage[] = [
  { src: "gaming", wide: false },
  { src: "desbloquearcontenido", wide: true },
  { src: "musica", wide: false },
  { src: "encuentroenvivo", wide: true },
  { src: "tecnologia", wide: false },
  { src: "saludo", wide: true },
  { src: "educacion", wide: false },
  { src: "live", wide: true },
  { src: "negocios", wide: false },
  { src: "sesionexclusiva", wide: true },
];

// Cuántas veces repetimos el set para llenar la cuadrícula. Cada repetición se
// rota un paso para no alinear la misma imagen en columnas contiguas.
const REPEATS = 5;
const ROTATE_STEP = 3;

function buildTiles(): CollageImage[] {
  const tiles: CollageImage[] = [];
  const len = CATEGORY_IMAGES.length;
  for (let r = 0; r < REPEATS; r++) {
    for (let i = 0; i < len; i++) {
      tiles.push(CATEGORY_IMAGES[(i + r * ROTATE_STEP) % len]);
    }
  }
  return tiles;
}

export default function LoginCollageBackground() {
  const tiles = buildTiles();

  return (
    <div className="login-collage-root" aria-hidden="true">
      <div className="login-collage-stage">
        <div className="login-collage-grid">
          {tiles.map((tile, i) => (
            <div
              key={i}
              className={`login-collage-tile${tile.wide ? " is-wide" : ""}`}
            >
              {/* Decorativo: <img> ligero, no next/image (son PNG pequeños). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/${tile.src}.png`}
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

        .login-collage-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          grid-auto-rows: auto;
          grid-auto-flow: row dense;
          gap: 16px;
          width: 150vw;
          transform-origin: center;
          transform: rotateX(15deg) rotateZ(-11deg) scale(1.08);
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
            transform: rotateX(15deg) rotateZ(-11deg) scale(1.08) translateY(0);
          }
          to {
            transform: rotateX(15deg) rotateZ(-11deg) scale(1.08)
              translateY(-46px);
          }
        }

        @media (max-width: 900px) {
          .login-collage-root {
            height: 118vh;
          }

          .login-collage-grid {
            grid-template-columns: repeat(6, 1fr);
            width: 240vw;
            gap: 10px;
            transform: rotateX(12deg) rotateZ(-9deg) scale(1.12);
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
