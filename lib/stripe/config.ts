// Config pública de Stripe (frontend). La PUBLISHABLE key es pública por diseño
// (va en el bundle del cliente); no es un secreto. Solo se usa para el pago
// embebido con Stripe.js/Elements (Checkout hospedado NO la necesita).
//
// Cuenta: Vibra On, LLC (acct_1U46R37tY0CtRg4D). La anterior era la entidad
// mexicana (acct_1TwS5nBSsPYFLsJ6); sus cus_/pm_/prod_ NO existen en esta cuenta.
//
// 🔁 CUTOVER a producción: definir NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY con la
// pk_live_... en el env de Vercel. El literal de abajo es solo el respaldo de
// desarrollo, así que el cambio a live NO requiere tocar este archivo.
// ⚠️ La llave DEBE ser de la misma cuenta que STRIPE_SECRET_KEY del backend: si
// se cruzan, Stripe.js confirma contra una cuenta que no creó el PaymentIntent.

export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
  "pk_test_51U46R37tY0CtRg4DVJt5Me7Pbz4qkE6yU8nF6QzQKQXaYpZwf7fPSG592ZE8rEe5J4ra4oLDPIpwjTCqZcwiAI5Q008Td6YhXr";
