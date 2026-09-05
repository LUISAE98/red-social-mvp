// Hasta cuándo se puede cancelar un CFDI.
//
// LA REGLA
//
// El cuarto párrafo del artículo 29-A del CFF dice que un comprobante solo se cancela **en el
// ejercicio en que se expidió**. La RMF lo amplía hasta el mes en que se presenta la declaración
// anual de ese ejercicio, lo que en la práctica da:
//
//   · Persona moral → **31 de marzo** del año siguiente.
//   · Persona física → **30 de abril** del año siguiente.
//
// 🚨 PASADO EL PLAZO NO HAY CANCELACIÓN POSIBLE, y no es un permiso que se pueda pedir: el SAT
//    simplemente rechaza la petición. Lo que queda entonces es una **nota de crédito**, que no
//    cancela nada pero documenta la devolución. Por eso este módulo no solo dice «no», dice
//    también qué hacer en su lugar.
//
// ⚠️ SE COMPRUEBA ANTES DE LLAMAR A FACTURAPI. Descubrirlo por el error del PAC funcionaría, pero
//    el mensaje que devuelve no le explica a nadie que existe otra vía; y en el caso de la global
//    llegaríamos con la venta ya apartada y a medio trámite.

/** Quién emite decide el plazo. Vibra y los creadores personas morales son `moral`. */
export type TipoDePersona = "moral" | "fisica";

/**
 * El último día en que se puede cancelar un CFDI emitido en `fechaEmision`.
 *
 * Devuelve el instante del CIERRE de ese día, no su comienzo: el 31 de marzo cuenta entero.
 */
export function limiteDeCancelacion(fechaEmision: Date, tipo: TipoDePersona): Date {
  const ejercicio = fechaEmision.getUTCFullYear();
  // Mes 2 es marzo y mes 3 es abril, con el índice base cero de JavaScript.
  const mes = tipo === "moral" ? 2 : 3;
  const dia = tipo === "moral" ? 31 : 30;
  return new Date(Date.UTC(ejercicio + 1, mes, dia, 23, 59, 59, 999));
}

/**
 * ¿Todavía se puede cancelar?
 *
 * @param ahora Se inyecta para poder probar el borde sin depender del reloj. Una prueba que
 *              pasa en marzo y falla en abril no prueba nada.
 */
export function dentroDePlazo(
  fechaEmision: Date,
  tipo: TipoDePersona,
  ahora: Date = new Date()
): boolean {
  return ahora.getTime() <= limiteDeCancelacion(fechaEmision, tipo).getTime();
}

/**
 * El mensaje que se le da a quien lo intenta fuera de plazo.
 *
 * Dice la fecha concreta y la salida, porque «no se puede» a secas deja a administración sin
 * saber qué hacer con una devolución que sigue siendo real.
 */
export function mensajeFueraDePlazo(fechaEmision: Date, tipo: TipoDePersona): string {
  const limite = limiteDeCancelacion(fechaEmision, tipo).toISOString().slice(0, 10);
  return (
    `Este comprobante ya no se puede cancelar: el plazo terminó el ${limite}. ` +
    "Para documentar la devolución hay que emitir una nota de crédito."
  );
}
