// Datos SAT del CONCEPTO para el CFDI (ClaveProdServ / ClaveUnidad + descripción).
//
// 🔁 FISCALISTA: estas claves son DEFAULTS defendibles para arrancar; el contador
// debe confirmarlas/afinarlas por tipo de servicio antes de producción. La forma y
// método de pago viven en el emisor (generateBuyerInvoice), no aquí.

export type SatProduct = { description: string; productKey: string; unitKey: string };

// Unidad "servicio" y una clave genérica de servicios de plataforma tecnológica.
const DEFAULT_UNIT_KEY = "E48"; // Unidad de servicio
const DEFAULT_PRODUCT_KEY = "81112100"; // Proveedores de servicios de aplicaciones/plataforma 🔁 FISCALISTA

// Descripción legible por tipo de servicio (LedgerServiceType). Si el tipo no está
// mapeado, cae a una descripción genérica. Las claves SAT son las default por ahora.
const DESCRIPTIONS: Record<string, string> = {
  saludo: "Saludo personalizado",
  consejo: "Consejo personalizado",
  mensaje: "Mensaje personalizado",
  exclusive_session: "Sesión exclusiva",
  meet_greet_digital: "Meet & greet digital",
  premium_post: "Contenido premium",
  live_access: "Acceso a transmisión en vivo",
  live_donation: "Apoyo en transmisión en vivo",
  profile_donation: "Apoyo al creador",
  super_comment: "Súper comentario",
  group_subscription: "Suscripción a comunidad",
};

export function productForType(type: string): SatProduct {
  return {
    description: DESCRIPTIONS[type] ?? "Servicio digital en Vibra",
    productKey: DEFAULT_PRODUCT_KEY,
    unitKey: DEFAULT_UNIT_KEY,
  };
}
