"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Un bloque que se pliega y se despliega hasta su altura real.
 *
 * 🚨 ANIMA PÍXELES, NO `fr`. El truco de `grid-template-rows: 0fr → 1fr` es el
 * que llevaba el producto y en Chrome se ve bien, pero en Safari tiembla: WebKit
 * vuelve a resolver la fracción contra el contenido en CADA fotograma, y cuando
 * dentro hay flex, imágenes o rejillas anidadas —o sea siempre— el alto
 * intermedio va y viene y arrastra consigo todo lo que hay debajo. En iPhone se
 * nota muchísimo y en Android no se nota nada, que es exactamente como se
 * reportó.
 *
 * Aquí el alto se MIDE con un ResizeObserver y se interpola en píxeles, que es
 * una animación determinista. De paso el navegador conoce el alto final desde el
 * primer fotograma, así que tampoco pelea con el anclaje del scroll.
 *
 * El observador sigue mirando mientras está abierto: si dentro carga una imagen
 * o cambia una lista, el alto se ajusta solo con la misma transición.
 */
export default function Collapsible({
  open,
  duration = 320,
  className,
  style,
  children,
}: {
  open: boolean;
  /** Milisegundos del plegado. La opacidad va algo más rápida, como antes. */
  duration?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const interiorRef = useRef<HTMLDivElement | null>(null);
  const [alto, setAlto] = useState(0);
  const [medido, setMedido] = useState(false);

  useEffect(() => {
    const nodo = interiorRef.current;
    if (!nodo) return;

    // 🚨 El `setState` va en el callback del observador, no en el cuerpo del
    // efecto. Escribirlo aquí directamente encadena renders y además lo prohíbe
    // la regla `react-hooks/set-state-in-effect`, que en este repo es error.
    const observador = new ResizeObserver((entradas) => {
      const entrada = entradas[0];
      if (!entrada) return;

      const medida =
        entrada.borderBoxSize?.[0]?.blockSize ?? entrada.contentRect.height;
      const siguiente = Math.ceil(medida);

      setAlto((previo) => (previo === siguiente ? previo : siguiente));
      setMedido(true);
    });

    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  return (
    <div
      className={className}
      aria-hidden={open ? undefined : true}
      style={{
        // Antes de la primera medida un bloque abierto va en `auto`: con 0 se
        // vería colapsar y volver en el primer fotograma.
        height: open ? (medido ? alto : "auto") : 0,
        overflow: "hidden",
        opacity: open ? 1 : 0,
        // ⚠️ El ANCLAJE DE SCROLL es el otro temblor, el de Chrome. Cuando
        // algo por encima del punto de mira cambia de alto, el navegador
        // corrige el scroll para que lo que mirabas no se mueva; con una
        // altura animandose eso pasa en CADA fotograma y el menu entero da
        // tirones. Aqui la persona esta mirando lo que se despliega, no lo
        // que hay debajo, asi que se apaga. Safari no lo implementa, por eso
        // alli no bastaba con esto.
        overflowAnchor: "none",
        // Aisla el repintado del subarbol para que el navegador no rehaga
        // el resto del menu en cada fotograma.
        contain: "paint",
        transition: `height ${duration}ms cubic-bezier(0.4,0,0.2,1), opacity ${Math.round(
          duration * 0.62
        )}ms ease`,
        ...style,
      }}
    >
      <div ref={interiorRef} style={{ minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
