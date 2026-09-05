import type { CSSProperties } from "react";

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
  flex: 1,
  minHeight: 42,
  borderRadius: 5,
  border: "none",
  background: "#a855f7",
  color: "rgba(255,255,255,0.98)",
  fontSize: 16,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "-0.02em",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

export const panelPrimaryBtnDisabled: CSSProperties = {
  ...panelPrimaryBtn,
  background: "rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.36)",
  cursor: "not-allowed",
};

export const panelSecondaryBtn: CSSProperties = {
  flex: "0 0 auto",
  minHeight: 42,
  padding: "0 16px",
  borderRadius: 5,
  border: "none",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
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
