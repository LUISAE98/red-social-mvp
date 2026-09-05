import type { CSSProperties } from "react";

/**
 * Forma y letra de un botón de acción de Vibra.
 *
 * Sale del botón «Seguir» del perfil, que es la referencia de la plataforma
 * para una acción primaria. Antes cada pantalla traía la suya: el compositor
 * tenía un publicar de 46/12/16 en celular, otro de 42/5/17 en laptop y un
 * monetizar de 34/5/13; el compositor de live, otro 42/5/17 por su cuenta.
 * Botones de la misma familia que no se parecían entre sí.
 *
 * 🚨 SOLO FORMA Y LETRA. El color NO va aquí, y es a propósito: publicar,
 * monetizar y programar tienen cada uno el suyo y esa diferencia sí es
 * intencionada. Quien use esto pone su fondo encima.
 *
 * Vive en `components/ui` porque lo comparten rutas distintas —publicaciones y
 * live—; antes estaba dentro de la carpeta de publicaciones y el compositor de
 * live habría tenido que importar de la ruta de al lado.
 */
export const BOTON_ACCION_FORMA: CSSProperties = {
  minHeight: 40,
  borderRadius: 10,
  border: "none",
  fontFamily: "inherit",
  fontWeight: 600,
  fontSize: 14,
  letterSpacing: "-0.01em",
  padding: "0 14px",
};
