/**
 * Notifica al servidor una compra concretada para marcar el mapa (globo).
 * Fire-and-forget: nunca bloquea ni rompe la UX de la compra si falla.
 * El servidor (Route Handler en Vercel) lee la geo aproximada por IP.
 *
 * Manda el token de Firebase porque el endpoint exige sesión: antes cualquiera
 * podía inflar los contadores de un creador sin identificarse. Vale la sesión
 * ANÓNIMA, que es la de las compras de invitado.
 */
import { getAuth } from "firebase/auth";

export function registrarCompraGeo(params: {
  creatorId: string | null | undefined;
  serviceType: string;
  grossAmount?: number | null;
}): void {
  const creatorId =
    typeof params.creatorId === "string" ? params.creatorId.trim() : "";
  if (!creatorId) return;

  try {
    void (async () => {
      const idToken = await getAuth().currentUser?.getIdToken();
      if (!idToken) return;
      await fetch("/api/registrar-compra-geo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          creatorId,
          serviceType: params.serviceType,
          grossAmount:
            typeof params.grossAmount === "number" ? params.grossAmount : undefined,
        }),
        keepalive: true,
      });
    })().catch(() => {});
  } catch {
    // Nunca propagar: es telemetría de mapa, no parte del pago.
  }
}
