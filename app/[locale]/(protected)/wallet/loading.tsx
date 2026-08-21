/**
 * Wallet. Este fallback NO dibuja nada, y es a propósito.
 *
 * El archivo existe solo por la frontera de Suspense que Next crea con él: es lo
 * que hace que ENTRAR a la wallet desde el bottom-nav cambie de pantalla al
 * instante en vez de esperar la respuesta del servidor. Sin el archivo, la
 * wallet heredaría el fallback de `(protected)`, que dibuja publicaciones.
 *
 * Pero no debe PINTAR nada, porque la wallet ya resuelve su propia espera y sus
 * propias transiciones, y un skeleton aquí las atropella:
 *
 * - El título y el subnav los pinta `wallet/layout.tsx` FUERA de esta frontera,
 *   así que permanecen fijos; lo único que se reemplazaría es el contenido.
 * - Los datos (`useOwnerWalletData`) viven en el LAYOUT, no en cada pestaña, así
 *   que moverse entre finanzas, estadísticas, calendario, pendientes e historial
 *   no carga nada — no hay espera que rellenar.
 * - Ese movimiento ya tiene su animación, y vive en `WalletSectionShell`, o
 *   sea DENTRO de esta frontera: la pestaña nueva se desliza desde el lado que
 *   corresponde en cuanto su contenido está listo. Ponerla fuera, en el layout,
 *   era el error de antes — el deslizamiento arrancaba con este fallback en
 *   pantalla y lo que se deslizaba era una caja vacía. Un skeleton aquí lo
 *   partiría en dos y se leería como un cambio de página entera.
 *
 * Si algún día una pestaña de la wallet carga sus propios datos, su skeleton va
 * DENTRO de esa página, no aquí.
 */
export default function Loading() {
  return null;
}
