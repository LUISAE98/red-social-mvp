"use client";

// ¿Puede ESTA persona ver ya un live de pago?
//
// ⚠️ Tiene que decir lo MISMO que `/api/cf-viewer-proxy`, que es quien de verdad
// sirve o niega el video. Cuando no coinciden salen las dos incoherencias
// desagradables: el servidor te deja ver pero la interfaz te tapa —que fue el
// fallo que esto viene a cerrar— o al revés, la interfaz te invita a mirar algo
// que luego no carga.
//
// Los tres caminos de acceso son los del proxy:
//   · compraste el boleto
//   · el creador liberó el live a los miembros y eres miembro
//   · eres el dueño de la comunidad donde se transmite
//
// El AUTOR no aparece: su propio live nunca entra a su feed, así que aquí no hay
// nada que decidir sobre él.

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import type { Post } from "@/lib/posts/types";
import { subscribeToLiveAccess } from "./live-access-service";

/** Estados de membresía que conservan acceso al contenido, como en las reglas. */
const MEMBRESIA_VALIDA = ["active", "subscribed", "muted"];

export type LiveTicketAccess = {
  /** Todavía no se sabe. Mientras tanto conviene no prometer nada. */
  checking: boolean;
  /** Puede ver el live sin pagar. */
  allowed: boolean;
};

export function useLiveTicketAccess(post: Post, enabled: boolean): LiveTicketAccess {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const groupId = typeof post.groupId === "string" ? post.groupId : null;
  const paidAccessMode = post.liveData?.paidAccessMode ?? null;
  const postId = post.id;

  // Las dos respuestas van MARCADAS con a qué pregunta corresponden.
  //
  // El mismo componente se reutiliza cambiándole la historia sin desmontarlo, y
  // un booleano suelto arrastraría la respuesta de la anterior: durante un
  // instante enseñaría desbloqueado un live que no has pagado. Comparando la
  // marca, lo que no corresponde simplemente no cuenta.
  const [boleto, setBoleto] = useState<{ postId: string; paid: boolean } | null>(null);
  const [comunidad, setComunidad] = useState<{ key: string; ok: boolean } | null>(null);

  const claveComunidad = `${groupId ?? ""}:${uid ?? ""}:${paidAccessMode ?? ""}`;

  // El boleto, en tiempo real: al pagar, el acceso se refleja solo en cuanto el
  // webhook lo materializa, sin recargar ni reabrir nada.
  useEffect(() => {
    if (!enabled || !uid) return;
    return subscribeToLiveAccess(postId, uid, (paid) => setBoleto({ postId, paid }));
  }, [enabled, uid, postId]);

  // Membresía y propiedad de la comunidad. Se lee una vez, y solo si el live es
  // de pago y vive en una comunidad.
  useEffect(() => {
    if (!enabled || !uid || !groupId) return;
    let cancelled = false;
    (async () => {
      try {
        const [grupo, miembro] = await Promise.all([
          getDoc(doc(db, "groups", groupId)),
          getDoc(doc(db, "groups", groupId, "members", uid)),
        ]);
        if (cancelled) return;
        const esDueno = grupo.data()?.ownerId === uid;
        const estado = miembro.exists() ? miembro.data()?.status : null;
        const esMiembro =
          miembro.exists() && (estado === undefined || MEMBRESIA_VALIDA.includes(String(estado)));
        const liberadoAMiembros = paidAccessMode === "members_free_non_members_pay";
        setComunidad({ key: claveComunidad, ok: esDueno || (liberadoAMiembros && esMiembro) });
      } catch {
        // Sin saberlo se asume que no: enseñar el candado de más se corrige
        // pagando; enseñarlo de menos regala el live.
        if (!cancelled) setComunidad({ key: claveComunidad, ok: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, uid, groupId, paidAccessMode, claveComunidad]);

  if (!enabled) return { checking: false, allowed: true };
  // Sin sesión no hay boleto que valga.
  if (!uid) return { checking: false, allowed: false };

  const porBoleto = boleto?.postId === postId && boleto.paid;
  const porComunidad = comunidad?.key === claveComunidad && comunidad.ok;

  return {
    // Se sigue averiguando mientras no haya llegado la respuesta del boleto,
    // que es el camino que tiene cualquiera.
    checking: boleto?.postId !== postId,
    allowed: porBoleto || porComunidad,
  };
}
