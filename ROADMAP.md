# Vibra — Roadmap de bloques de trabajo

> Documento maestro de lo que falta por integrar, organizado en **bloques desplegables paso a paso**.
> Creado 2026-07-30. Fuentes de detalle: `docs/stripe-integracion.md`, `docs/facturacion-pendientes.md`, `docs/legal/fiscal-iva-isr-plataforma.md`.
>
> ⚠️ **Este documento es de julio de 2026 y varias decisiones cambiaron después.** Se conserva
> porque el orden de los bloques sigue valiendo, pero antes de programar nada a partir de aquí,
> comprobar contra la fuente de verdad. Lo que ya NO rige:
>
> | Dice aquí | Vigente | Dónde manda |
> |---|---|---|
> | Vibra vendedor directo | **Intermediación** (2026-08-26) | `docs/legal/fiscal-iva-isr-plataforma.md` |
> | Stripe Connect | **Global Payouts** | `backend/src/payments/stripe/globalPayoutsRecipient.ts` |
> | Stripe hace el KYC, se elimina Didit | **Didit**, reintegrado el 2026-08-27 | `backend/src/kyc.ts` |
> | Comisión 23% | **25%**, o 30% en ruta cara | `lib/wallet/payoutTiers.ts` |
> | Mínimo $2.000 MXN | **300 USD**, o 500 en ruta cara | `lib/wallet/payoutTiers.ts` |
> | Entidad y moneda mexicanas | **Vibra On, LLC**, denominación USD | `docs/stripe-integracion.md` |
> **Regla:** cada bloque se construye, se prueba y se despliega antes de pasar al siguiente. México primero; los demás países se activan por configuración.

---

## Orden macro

```
EN PARALELO (pista humana, no código):
  • LEGAL + FISCALISTA  → definen retenciones, edad mínima, constancias, T&C

PISTA DE CÓDIGO (una cosa a la vez):
  1. API DE PAGOS (Stripe)        ← EMPEZAMOS AQUÍ
  2. WALLET / payouts (encima de Stripe)
  3. IMPUESTOS (Stripe Tax comprador + retenciones creador)
  4. FACTURACIÓN (bloques del creador)
  5. NOTIFICACIONES faltantes
  6. MODERACIÓN (al final)
```

---

## Estado actual (ya hecho)
- ✅ Facturación comprador (Bloque 2): CFDI Vibra→comprador con Facturapi (modo prueba), correo, descarga.
- ✅ Datos fiscales comprador/creador + KYC creador con **Didit**, que se queda: Global Payouts no
  trae KYC. ⚠️ Esta línea decía «que Stripe reemplazará», de cuando el plan era Connect.
- ✅ IVA del comprador (México 16%) calculado en backend.
- ✅ Wallet interna (ledger) y experiencias del comprador.
- 🔶 Todo el sistema de pagos actual es **Mercado Pago** → se migra a Stripe.

## Decisiones pendientes (no bloquean arrancar, sí antes de producción)
- **D1** — ¿Quién absorbe el ~5% de Stripe? (**25%** de Vibra / comprador / creador). Afecta el ledger.
  ⚠️ La comisión ya no es el 23% que decía esta línea: es **25%**, o **30%** en los países de
  ruta cara. Sale de `lib/wallet/payoutTiers.ts`, no de este documento.
- **D2** — Reservas/holds de Stripe (preguntar en reunión).
- **D3** — Retenciones ISR/IVA (mexicano y extranjero) → **fiscalista**.
- **D4** — KYC internacional: ¿el creador extranjero necesita **LLC US + EIN** o basta banco US (Wallbit/Takenos)? → probar.
- **D5** — Edad mínima: cláusula en T&C (no verificación técnica).

---

# BLOQUE A — API de pagos (Stripe)  ← EN CURSO

> Sub-bloques desplegables. Cada `S#` es un deploy. Detalle técnico en `docs/stripe-integracion.md`.

### S1 · Fundamentos
- Crear cuenta Stripe de Vibra + activar **Connect** + **Stripe Tax**.
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (test).
- Cliente único backend `stripeClient.ts` (como `facturapiClient`).
- **Entrega:** conexión verificada (healthcheck).

### S2 · Cobro en México (charge)
- Cobrar al comprador con tarjeta vía Stripe (PaymentIntent) — empezar por 1 servicio (ej. saludo).
- Registrar el pago + reflejar en el ledger (reusar el modelo de hoy).
- **Entrega:** una compra real de prueba pagada con Stripe en México.

### S3 · Guardar tarjeta (un-clic)
- `Customer` + `PaymentMethod` reutilizable (off-session) con Stripe.js/Elements.
- **Entrega:** comprador guarda tarjeta y re-compra con un clic.

### S4 · Webhooks
- Endpoint de webhooks con **verificación de firma** + **idempotencia** (`event.id`).
- Eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
- **Entrega:** reemplaza `mpWebhook` para los flujos migrados.

### S5 · Connect — alta del creador — ⚠️ SUPERADO
> **Stripe Connect se abandonó.** El alta va por **Global Payouts**
> (`backend/src/payments/stripe/globalPayoutsRecipient.ts`), que **no** trae verificación de
> destinatarios, así que el **KYC lo hace Didit** — no se eliminó, se reintegró el 2026-08-27
> (`backend/src/kyc.ts`, `lib/kyc/useKyc.ts`). `stripeConnect.ts` sigue en el árbol pero no
> lo importa nadie.

- Botón en Wallet "Da de alta tu cuenta para recibir tus pagos".
- Crear destinatario de **Global Payouts** + formulario alojado + webhook de capacidades.
- Rama por país: Stripe local → banco local; solo wire → tramo del 30%; sin ruta → Wallbit.
- **Entrega:** creador se da de alta y queda "listo para cobrar". ⚠️ **NO reemplaza a Didit**:
  esta línea asumía Connect, que traía el KYC incluido. Con Global Payouts, Didit sigue siendo
  el primer paso del alta.

### S6 · Payouts (retiro)
- `transfer` plataforma→creador + payout a su banco. **Mínimo 300 USD**, o **500 USD** en los
  países a los que solo llega la transferencia internacional, que cuesta 25 USD fijos y a 300
  se comería más del 8%. La cifra NO se escribe a mano en ningún sitio: sale de
  `lib/wallet/payoutTiers.ts` (espejo en `backend/src/wallet/`). Detalle en `docs/payout-tiers.md`.
- Cablear el flujo de "pedir retiro" (`withdrawalRequests`).
- **Entrega:** el creador retira y le llega a su banco.

### S7 · Suscripciones (membresías de comunidad)
- Stripe Billing (Product/Price/Subscription) + `application_fee` + dunning.
- **Entrega:** reemplaza `payGroupSubscription` (Preapproval MP).

### S8 · Migrar el resto de cobros
- Portar las demás vías de pago (donaciones, súper comentario, live, premium post, etc.) de MP a Stripe.
- **Entrega:** MP ya no cobra nada nuevo.

### S9 · Reembolsos y disputas
- Reembolso (con `reverse transfer` en Connect) + manejo de disputas + Radar.
- **Entrega:** flujo de reembolso funcional.

### S10 · Cutover a producción
- Llaves **live**, migrar datos/tarjetas pendientes, apagar Mercado Pago.
- **Entrega:** Stripe en producción, MP desmantelado.

---

# BLOQUE B — Wallet / payouts
> Se apoya en A (S5/S6). Ajustes al ledger para el modelo Stripe.
- Conciliar ledger interno ↔ balance Stripe (transfer + payout).
- Reflejar comisión Stripe según **D1** (quién la absorbe).
- Estado de retiros en finanzas (pestaña ya preparada) + revisión humana.
- Mínimo de retiro $2,000 + frecuencia (1–2/mes).

---

# BLOQUE C — Impuestos
- **Comprador (multi-país):** activar **Stripe Tax** → cálculo + rastreo de obligaciones por país. (Reemplaza/complementa el IVA propio.)
- **Creador (retenciones):** ISR/IVA según residencia (mexicano vs extranjero) → **fiscalista (D3)**.
  - Mexicano: retención 113-A + CFDI (Facturapi).
  - Extranjero: posible retención a residente en el extranjero (baja con **constancia de residencia fiscal**).
- Config por país versionada (agregar país = config, no código).

---

# BLOQUE D — Facturación
> Detalle completo en `docs/facturacion-pendientes.md`.
- ✅ Bloque 2 (comprador) hecho.
- ⏸️ Bloque 3 (creador manual + retiro), 4 (creador auto/self-billing — llave de org ya resuelta), 5 (retenciones) → dependen de A + fiscalista.
- 🔒 Bloque 6 (notas de crédito), 7 (factura global) → después.
- 🌎 Bloque 8 (recibo internacional) → creador/comprador extranjero.

---

# BLOQUE E — Legal (en paralelo, pista humana)
- Términos y Condiciones (incl. **edad mínima** — D5) + Acuerdo de creador.
- Avisos de privacidad, cookies, normas de comunidad, política de reembolsos.
- Onboarding fiscal del creador extranjero: capturar **constancia de residencia fiscal**.
- Cláusulas de vendedor de registro / self-billing.
- (Base ya existe en `docs/legal/`.)

---

# BLOQUE F — Notificaciones faltantes
> Catálogo en `docs/notificaciones-catalogo.md`.
- Cerrar el sistema de notificaciones (arranca casi de cero).
- Eventos de dinero (pago recibido, retiro pagado, factura lista, suscripción, disputa).

---

# BLOQUE G — Moderación (al final)
- Panel de moderación completo (reportes, bloqueos, revisión).
- Nota: la **seguridad básica de contenido** (reportar/bloquear) no debe faltar el día del launch, aunque el panel completo vaya al final.

---

## Países de lanzamiento
- **Meta:** 19 países (17 LatAm + Canadá + EE.UU.), revisando uno por uno.
- **Arranque:** **México** (fiscalmente listo). Payout limpio: MX, BR, US, CA. Los 15 LatAm restantes → vía Wallbit/Takenos (validar KYC — D4).
- Expansión = activar config por país conforme se valida tasa (Stripe Tax) + payout + fiscalista.
