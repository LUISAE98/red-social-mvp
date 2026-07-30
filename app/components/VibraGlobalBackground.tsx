/**
 * Fondo animado, filtro de color y partículas del login RETIRADOS por decisión
 * de producto (rendimiento y estética): las 86 partículas animadas causaban
 * lentitud y "traba" al iniciar/cerrar sesión.
 *
 * Las páginas de autenticación usan ahora el fondo base de la app (#000000,
 * definido en globals.css / layout raíz). El componente se conserva (renderiza
 * null) para no tener que tocar el layout que lo monta.
 */
export default function VibraGlobalBackground() {
  return null;
}
