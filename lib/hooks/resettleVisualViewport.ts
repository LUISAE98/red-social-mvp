"use client";

/**
 * Obliga a iOS a reasentar el viewport VISUAL.
 *
 * El problema que resuelve
 * ------------------------
 * Cuando una pantalla bloquea el scroll del fondo (`useBodyScrollLock` pone
 * `overflow: hidden` en html y body) y dentro de ella se abre el teclado, iOS no
 * puede desplazar el DOCUMENTO para hacerle sitio, así que desplaza el viewport
 * VISUAL dentro del de layout: `visualViewport.offsetTop` se va por encima de 0.
 *
 * Al cerrarse el teclado, iOS devuelve ese desplazamiento **solo si el documento
 * puede moverse**. Con el fondo bloqueado no puede, y el desfase se queda puesto.
 * A partir de ahí:
 *
 *   · dentro de la pantalla, el campo de escritura no vuelve al borde y parece
 *     que se hubiera creado un safe-area de la nada;
 *   · y al salir, todo lo que va `position: fixed` —la barra inferior, sin ir más
 *     lejos— se pinta contra el viewport de LAYOUT y aparece más arriba de donde
 *     toca. No se endereza hasta navegar a otra sección, que es lo que por fin
 *     provoca el reasiento.
 *
 * Android no lo sufre: ahí el navegador encoge el viewport de layout de verdad
 * (`interactive-widget=resizes-content`) y no queda desfase que arrastrar.
 *
 * Qué hace
 * --------
 * 1. Suelta el foco, pero SOLO si lo tiene un campo de texto. Mientras un campo
 *    lo tenga, iOS da el teclado por vivo y no reasienta nada. Fuera de ese caso
 *    no se toca el foco: robárselo a un botón rompería la navegación por teclado.
 * 2. Desplaza el documento un píxel y lo devuelve. Un desplazamiento programado
 *    es lo que obliga al motor a recalcular la geometría; ir y volver en el mismo
 *    frame no se ve.
 * 3. Lo repite en el siguiente frame, porque quien llama suele hacerlo al cerrar
 *    o al desmontar y el bloqueo del fondo se suelta en esa misma tanda: hasta el
 *    frame siguiente el documento todavía no puede moverse y el paso 2 no tendría
 *    ningún efecto.
 *
 * Si no hay nada que arreglar —ni campo enfocado ni desfase— no hace nada.
 */
export function resettleVisualViewport(scrollY?: number): void {
  if (typeof window === "undefined") return;

  const activo = document.activeElement as HTMLElement | null;
  const esCampo =
    !!activo &&
    (activo.tagName === "INPUT" ||
      activo.tagName === "TEXTAREA" ||
      activo.isContentEditable);

  if (esCampo && typeof activo.blur === "function") activo.blur();

  const desfase = window.visualViewport?.offsetTop ?? 0;
  // Sin teclado que se vaya y sin desfase acumulado no hay nada que reasentar, y
  // un scroll programado de más puede cortar un desplazamiento suave en curso.
  if (!esCampo && desfase === 0) return;

  const destino = scrollY ?? window.scrollY;

  const empujar = () => {
    // Ida y vuelta en el mismo frame: invisible, pero suficiente para que el
    // motor recalcule. Un `scrollTo` a la MISMA posición puede ignorarse.
    window.scrollTo(0, destino + 1);
    window.scrollTo(0, destino);
  };

  empujar();
  requestAnimationFrame(empujar);
}
