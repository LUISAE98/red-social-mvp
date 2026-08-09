"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * `/groups` era el índice que montaba el OwnerSidebar. Ese contenido se movió a
 * `/menu`, detrás del avatar del nav inferior.
 *
 * Esta ruta se conserva como redirección porque sigue siendo el destino natural
 * al salir de una comunidad (`router.replace("/groups")` tras abandonarla o
 * borrarla) y de enlaces antiguos. Se usa `replace` para no dejar un paso
 * intermedio en el historial: el botón de atrás no debe volver aquí.
 */
export default function GroupsIndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/menu");
  }, [router]);

  return null;
}
