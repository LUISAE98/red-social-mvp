/**
 * Tasas de la wallet. Constantes puras, sin React ni Firebase.
 *
 * Estaban dentro de `walletFinances`, que es un módulo "use client" con hooks y
 * listeners de Firestore. Eso obligaba a arrastrar medio SDK para leer un número
 * fijo, y hacía imposible probar sin credenciales cualquier cálculo que
 * dependiera de la comisión.
 *
 * 🚨 Este valor debe coincidir con `backend/src/wallet/ledger.ts`. Si cambia la
 * comisión, cambia en los dos sitios o el neto que se le enseña al creador no
 * será el que se le liquida.
 */

/** Comisión de la plataforma sobre cada venta. */
export const WALLET_COMMISSION_RATE = 0.25;

/** Lo que le queda al creador: 0.75. */
export const WALLET_NET_RATE = 1 - WALLET_COMMISSION_RATE;
