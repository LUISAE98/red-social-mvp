// Datos SAT del CONCEPTO para el CFDI: ClaveProdServ, ClaveUnidad y descripción.
//
// La forma y el método de pago viven en el emisor (`generateBuyerInvoice`), no aquí.
//
// ── Las claves, confirmadas el 2026-08-29 ───────────────────────────────────────────────
//
// Los once servicios no son once cosas distintas para el SAT: son **tres**. Se agrupan por lo
// que el comprador recibe, que es lo que la factura tiene que describir.
//
// ⚠️ Antes los once iban con `81112100`, «Servicios de internet». Vibra no vende acceso a
// internet, y esa clave estaba en TODAS las facturas a compradores.
//
// 🚨 **Cambiar la clave NO cambia el impuesto.** Las cuatro están marcadas «IVA trasladado:
// Opcional» en el catálogo y ninguna arrastra complemento, así que el 16%, el 0% de exportación
// y las retenciones siguen saliendo del motor fiscal. La clave describe QUÉ se vendió; el
// tratamiento lo decide la ley. Esto es precisión documental, no un cambio de régimen.

import type { LedgerServiceType } from "../wallet/ledger";

export type SatProduct = { description: string; productKey: string; unitKey: string };

/** Unidad "servicio". La misma para los once. */
const UNIT_KEY = "E48";

/** Contenido grabado que el comprador consume cuando quiere. */
const GRABADO = "90131602"; // Entretenimiento grabado en video

/** Ocurre en directo, con el creador presente. */
const EN_VIVO = "90131500"; // Actuaciones en vivo

/** No compra una pieza, compra acceso continuo. */
const PLATAFORMA = "43233419"; // Plataformas de multimedia

/**
 * Qué se factura por cada servicio.
 *
 * 🚨 Es un `Record` COMPLETO de `LedgerServiceType` a propósito: si mañana se añade un servicio
 * y nadie le pone su fila, **TypeScript no compila**. Antes esto era un mapa suelto con claves
 * escritas a mano —`saludo` en vez de `greeting`, `live_access` en vez de `live_ticket`— y
 * siete de los once caían a una descripción genérica sin que nadie se enterara.
 */
const CONCEPTOS: Readonly<Record<LedgerServiceType, { description: string; productKey: string }>> = {
  // ── Grabado ───────────────────────────────────────────────────────────────
  greeting: { description: "Saludo personalizado", productKey: GRABADO },
  advice: { description: "Consejo personalizado", productKey: GRABADO },
  premium_post: { description: "Contenido premium", productKey: GRABADO },
  vod_ticket: { description: "Acceso a transmisión grabada", productKey: GRABADO },

  // ── En vivo ───────────────────────────────────────────────────────────────
  live_ticket: { description: "Acceso a transmisión en vivo", productKey: EN_VIVO },
  exclusive_session: { description: "Sesión exclusiva en video", productKey: EN_VIVO },
  live_session: { description: "Encuentro en video con el creador", productKey: EN_VIVO },

  // ── Acceso continuo ───────────────────────────────────────────────────────
  subscription: { description: "Suscripción a comunidad", productKey: PLATAFORMA },

  /**
   * ── Apoyos ────────────────────────────────────────────────────────────────
   *
   * ⚠️ **No son donativos.** Vibra no es donataria autorizada y el creador tampoco, así que
   * este dinero es un ingreso por su actividad y va gravado como cualquier otro. En el súper
   * comentario además hay contraprestación evidente: el mensaje se destaca.
   *
   * Tratarlos como donativo sería el error caro, y por eso van con la clave del contenido que
   * acompañan.
   */
  profile_donation: { description: "Apoyo al creador", productKey: GRABADO },
  live_donation: { description: "Apoyo en transmisión en vivo", productKey: GRABADO },
  supercomment: { description: "Súper comentario destacado", productKey: GRABADO },
};

/**
 * El concepto del CFDI para un tipo de venta.
 *
 * El parámetro es `string` y no `LedgerServiceType` porque llega desde el ledger ya guardado, y
 * un asiento viejo podría traer un tipo que ya no existe. En ese caso cae a lo genérico en vez
 * de romper una factura.
 */
export function productForType(type: string): SatProduct {
  const concepto = CONCEPTOS[type as LedgerServiceType];
  return {
    description: concepto?.description ?? "Servicio digital en Vibra",
    productKey: concepto?.productKey ?? GRABADO,
    unitKey: UNIT_KEY,
  };
}
