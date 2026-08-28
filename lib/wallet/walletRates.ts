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

/**
 * Comisión de la plataforma sobre cada venta.
 *
 * ⚠️ **YA NO ES UNA CONSTANTE (decisión 2026-08-27).** La comisión depende del país de la
 * cuenta de cobro del creador: **25% estándar, 30% donde la transferencia es cara** (los 29
 * países de wire). Ver `docs/payout-tiers.md`.
 *
 * 🚧 Este valor se conserva como el del grupo ESTÁNDAR mientras se construye el sistema de
 * niveles. Todo lo que lo importe hoy asume 25% para todos, que es correcto para 45 países de
 * 74 pagables y **se queda corto para los otros 29**.
 */
export const WALLET_COMMISSION_RATE = 0.25;

/** Lo que le queda al creador: 0.75. */
export const WALLET_NET_RATE = 1 - WALLET_COMMISSION_RATE;
