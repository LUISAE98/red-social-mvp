/**
 * Notifica al servidor una compra concretada para marcar el mapa (globo).
 * Fire-and-forget: nunca bloquea ni rompe la UX de la compra si falla.
 * El servidor (Route Handler en Vercel) lee la geo aproximada por IP.
 */
export function registrarCompraGeo(params: {
  creatorId: string | null | undefined;
  serviceType: string;
  grossAmount?: number | null;
}): void {
  const creatorId =
    typeof params.creatorId === "string" ? params.creatorId.trim() : "";
  if (!creatorId) return;

  try {
    void fetch("/api/registrar-compra-geo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorId,
        serviceType: params.serviceType,
        grossAmount:
          typeof params.grossAmount === "number" ? params.grossAmount : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nunca propagar: es telemetría de mapa, no parte del pago.
  }
}
