import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// DESACTIVADO — este endpoint acuñaba dinero.
//
// Escribía con Admin SDK (saltándose el `create: if false` de las Firestore
// Rules) un `posts/{postId}/superComments/{id}` con `status: "paid"` y el
// `amount` que mandara el cliente, SIN sesión y SIN cobro. Eso dispara
// `onSuperCommentLedger` (backend/src/wallet/ledgerTriggers.ts), que registra un
// earning REAL en la wallet del creador. Un `curl` bastaba para inflar ingresos
// y, de paso, para inyectar contenido en el chat de cualquier live.
//
// Los supercomentarios y donaciones en vivo solo se materializan tras un pago
// APROBADO de Stripe (webhook → reconcile → `materializeFromIntent`). Los
// invitados NO tienen todavía vía de cobro propia: los callables de Stripe
// (`superCommentStripeIntent`, `liveDonationStripeIntent`) exigen sesión.
//
// Cuando exista el cobro de invitados debe entrar por su propio flujo
// server-authoritative (intent → webhook → reconcile), nunca creando el doc
// aquí a mano.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Los supercomentarios de invitado no están disponibles todavía. Inicia sesión para enviarlo.",
    },
    { status: 501 },
  );
}
