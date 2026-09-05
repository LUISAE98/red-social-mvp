import type { CSSProperties } from "react";

import { BOTON_ACCION_FORMA } from "./botonAccion";

/**
 * Los dos botones del pie de un panel de Vibra: guardar y cancelar.
 *
 * Guardar manda —morado, ocupa el hueco que sobre— y cancelar acompaña, gris y
 * del ancho de su texto. Es el pie que ya usaban la configuración del perfil y
 * la del espacio personal.
 *
 * 🚨 VIVE AQUÍ PORQUE ESTABA COPIADO. Las mismas trece propiedades aparecían
 * palabra por palabra en dos archivos, y al llegar un tercero —la configuración
 * de la comunidad— la copia se habría vuelto la norma. Copiado, "igual" dura
 * hasta que alguien retoca uno de los tres.
 */
export const panelPrimaryBtn: CSSProperties = {
  // Forma y letra del boton de seguir del perfil, la misma que ya usan
  // publicar, editar y monetizar. El color lo pone este modulo.
  ...BOTON_ACCION_FORMA,
  flex: 1,
  background: "#a855f7",
  color: "rgba(255,255,255,0.98)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

export const panelPrimaryBtnDisabled: CSSProperties = {
  ...panelPrimaryBtn,
  background: "rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.36)",
  cursor: "not-allowed",
};

export const panelSecondaryBtn: CSSProperties = {
  ...BOTON_ACCION_FORMA,
  flex: "0 0 auto",
  padding: "0 16px",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

/**
 * El de cancelar mientras se guarda.
 *
 * No se deshabilita del todo con el aspecto del primario: cancelar sigue siendo
 * la salida, y apagarlo por completo deja a la persona sin puerta mientras dura
 * la escritura. Solo se atenúa y deja de responder.
 */
export function panelSecondaryBtnStyle(guardando: boolean): CSSProperties {
  return {
    ...panelSecondaryBtn,
    cursor: guardando ? "not-allowed" : "pointer",
    opacity: guardando ? 0.7 : 1,
  };
}
