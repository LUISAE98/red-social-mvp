// Config pública de Stripe (frontend). La PUBLISHABLE key es pública por diseño
// (va en el bundle del cliente); no es un secreto. Solo se usa para el pago
// embebido con Stripe.js/Elements (Checkout hospedado NO la necesita).
//
// 🔁 CUTOVER: al pasar a producción, cambiar por la pk_live_... (o moverla a
// NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY en el env de Vercel).

export const STRIPE_PUBLISHABLE_KEY =
  "pk_test_51TwS5nBSsPYFLsJ6OL4MNc8PUn1ELCo5TwxOFwt3UpVpLty18frQj0Zx7dL7EQhCIPgqG2sC6rwbYDvMsa0oPj4L00ZreMKHQ1";
