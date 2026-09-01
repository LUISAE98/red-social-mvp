# Facturación — Estado y pendientes de integración

> Última actualización: 2026-07-30. Fuente de verdad del avance de facturación (CFDI 4.0, Facturapi).
> ⚠️ **MODELO ACTUALIZADO 2026-08-26: INTERMEDIACIÓN.** Vibra ya no vende: intermedia y cobra por cuenta
> del creador. **Todo lo que este documento diga sobre vendedor directo está superado.** Detalle fiscal
> vigente en `docs/legal/fiscal-iva-isr-plataforma.md` §0.
>
> **Los tres comprobantes del modelo vigente:**
> 1. **Venta al comprador** — la emite Vibra **por cuenta del creador**, con el sello del creador.
> 2. **Comisión** — Vibra al creador mexicano, 25% + IVA.
> 3. **Constancia de retenciones** — Vibra al creador mexicano, periódica.
>
> Creador no mexicano: comprobante de pago **más la constancia de retenciones cuando se le retiene
> impuesto mexicano**. Solo el caso extranjero-extranjero se queda sin constancia.
>
> Detalle documento por documento y caso por caso en `docs/legal/fiscal-iva-isr-plataforma.md` §0.3.
>
> 🔴 **La factura global deja de ser opcional**: cada creador tiene ahora su propia obligación de
> facturar todas sus ventas. Ver §0.3 del documento fiscal.

## Actualización Stripe (2026-07-30)

> ⚠️ **Instantánea de julio, conservada como historial. Varias cifras de aquí abajo ya no rigen**
> y la advertencia de la cabecera no las cubre, porque no hablan de vendedor directo sino de
> números:
>
> | Dice abajo | Vigente | Dónde manda |
> |---|---|---|
> | Comisión **23%** | **25%**, o 30% en ruta cara | `lib/wallet/payoutTiers.ts` |
> | Mínimo de retiro **$2.000 MXN** | **300 USD**, o 500 en ruta cara | `lib/wallet/payoutTiers.ts` |
> | **Stripe Connect** | **Global Payouts** | `backend/src/payments/stripe/globalPayoutsRecipient.ts` |
> | Connect trae el KYC, «se elimina Didit» | **Didit**, reintegrado el 2026-08-27 | `backend/src/kyc.ts` |
> | Liquidación en **MXN** | Denominación **USD**, entidad Vibra On, LLC | `docs/stripe-integracion.md` |

**Migración: 100% de Mercado Pago → Stripe** (confirmado). Es el proyecto grande sobre el que va la facturación.

- **Modelo aceptado** por Stripe (streaming + creadores, sin contenido sexual). Usaremos **Stripe Connect, plan "Tú controlas los precios"**. ⚠️ La nota original decía *Vibra como vendedor directo (Merchant of Record)*; **desde el 2026-08-26 Vibra es intermediaria** y cobra por cuenta del creador.
- **Flujo de dinero (Opción B, agregador):** todo cae en Vibra; Vibra paga al creador (1–2 payouts/mes).
- **Costos Stripe:** cobro 3.6% + 3 MXN (+0.5% si internacional); cuenta activa de creador **35 MXN/mes**; transferencia (payout) **0.25% + 12 MXN**. Total ≈ **<5% + fijos** (los fijos pegan en volumen bajo).
- **Mínimo de retiro: $2,000 MXN** (para que los fijos no se coman el payout).
- **⚠️ DECISIÓN PENDIENTE — quién absorbe el ~5% de Stripe:** ¿el 23% de Vibra (neto ≈18%), se pasa al comprador, o se descuenta al creador? Define cómo el ledger registra el neto.
- **Liquidación en MXN** (Stripe Adaptive Pricing muestra moneda local al comprador). El CFDI del comprador sigue en MXN.
- **Países / payouts:** en LatAm Stripe solo paga **local en México y Brasil**. Resto de LatAm: el creador abre **Wallbit o Takenos** y cobra en **USD**. → Los creadores se parten en: **mexicano** (CFDI + retenciones MX, Bloques 3/4/5) vs **extranjero** (USD, sin CFDI, **Bloque 8** aplica también a CREADORES).
- **Stripe Tax:** solo calcula/recauda el **IVA de la venta (al comprador)** y valida RFC. **NO** hace retenciones ISR/IVA al creador, **NO** emite CFDI, **NO** reporta al SAT → las **retenciones (Bloque 5) siguen siendo de Vibra + fiscalista**.
- **KYC:** Stripe Connect trae **KYC/KYB del creador gratis** → probablemente se **elimina Didit** (confirmar si Didit hace también verificación de edad u otro uso).
- **Reservas/holds de Stripe:** no preguntado aún (otra reunión).
- **Suscripciones recurrentes:** soportadas (Stripe Billing) para membresías de comunidad.
- **Cuenta de prueba (sandbox):** disponible.

**Márgenes (estimado):** 23% comisión − ~5% Stripe − ~8% infra (Mux, CF, Firebase, LiveKit, Vercel, Facturapi) ≈ **~10% neto del GMV**. Los costos de infra son por USO (no % fijo); el riesgo es el video/live/llamadas por peso vendido (rango realista infra ~6–15%).

**Orden al retomar:** 1) integrar Stripe (cobros + Connect + payouts + suscripciones + webhooks), 2) retenciones/fiscal (Bloque 5, con fiscalista), 3) facturas del creador (Bloques 3, 4 y 8).

---

## Dependencia principal

**La pasarela es Stripe** (decidido; migración completa MP → Stripe, ver arriba). Lo que aún falta para destrabar la facturación del creador es: **(1) integrar Stripe** (cobros + Connect + payouts) y **(2) definir el modelo de retenciones ISR/IVA con un fiscalista** (Stripe NO lo hace). De eso dependen el monto/IVA/retenciones de la factura del creador.

Modo actual: **Facturapi en PRUEBA (`sk_test`)** → todo lo que se timbra es de prueba, **aún no fiscal**.

---

## ✅ HECHO

### Bloque 1 — Datos fiscales
- Perfiles fiscales del **comprador** (varios, tipo "tarjetas guardadas": `users/{uid}/billingProfiles`) con validación de RFC contra el SAT vía Facturapi.
- Perfil fiscal del **creador** (`creatorTaxProfiles`) + subida de **CSD** (lazy, al primer retiro; el CSD vive en Facturapi, nunca en Firestore).

### Bloque 2 — Factura del comprador (Vibra → comprador)
- Selección de movimientos en `/experiencias → Entregados → Todo` + panel `BuyerInvoicePanel`.
- Timbrado del CFDI en la **org de Vibra** con **MXN real** cobrado (del `settlementAmount` del `paymentIntents/{id}`; fallback FX si no hay intent).
- **Envío por correo** (PDF+XML) al correo capturado + **descarga de PDF**.
- Marca `invoiced: true` en la compra ("· Facturado"), no re-facturable, sale del modo selección al terminar.
- Backend: `generateBuyerInvoice`, `downloadBuyerInvoice`. Marcadores `🔁 FISCALISTA` (ClaveProdServ `81112100`, ClaveUnidad `E48`, forma `04`, método `PUE`) en `satProductCatalog.ts` — confirmar con contador.

### Bloque 4 — Desbloqueo técnico (self-billing)
- Confirmado que Facturapi **sí entrega la API key por organización**: `GET /organizations/{id}/apikeys/test` (con la USER key) → `sk_test_...`. El 401 previo era por ruta equivocada.
- Con esa llave se podrá timbrar el CFDI del creador dentro de su org. **Falta la emisión** (ver abajo).

---

## ⏸️ PENDIENTE — esperan la PASARELA + modelo fiscal

### Bloque 3 — Factura del creador MANUAL + flujo de retiro
- Cablear **"pedir retiro"** (hoy `withdrawalRequests` es solo un tipo; ningún callable la crea).
- El creador sube **PDF + XML** → se **adjunta a la solicitud de retiro** (Storage) → **auto-validación del XML** (receptor = RFC de Vibra, total = base+IVA, UUID timbrado) → revisión humana en la pestaña de retiros de finanzas.
- Depende del modelo fiscal (monto/IVA/retenciones) para saber contra qué validar el total.

### Bloque 4 — Factura del creador AUTOMÁTICA (self-billing) — EMISIÓN
- Sacar/guardar la API key de la org del creador (ya sabemos cómo) y **timbrar** el CFDI del creador (receptor = Vibra) dentro de su org.
- Adjuntarlo a la solicitud de retiro.
- Depende del modelo fiscal (mismo monto/IVA/retenciones que el 3).

### Bloque 5 — Retenciones + CFDI de retención
- Cálculo de **ISR/IVA retenidos** al creador (50%/100% IVA + ISR según residencia y monto) en el ledger.
- Emisión del **CFDI de retenciones**.
- Es el corazón fiscal; **requiere la pasarela + fiscalista**.

---

## 🔒 PENDIENTE — dependen de que 3/4/5 estén hechos

### Bloque 6 — Reembolsos post-factura → Nota de crédito
- Si una compra **ya facturada** se reembolsa: emitir **nota de crédito (CFDI de egreso)** o cancelar el CFDI.
- No se puede cerrar hasta tener la emisión (2 ya está; pero el flujo de retención/creador también genera CFDIs que podrían requerir nota de crédito).

### Bloque 7 — Factura global (público en general)
- CFDI **global mensual** por lo NO facturado nominalmente + **plazo de facturación** (reglas SAT: mismo mes / fecha límite).
- Depende de tener cerrado el ciclo de emisión nominal.

---

## 🌎 PENDIENTE — depende de PAGOS INTERNACIONALES

### Bloque 8 — Recibo internacional (no-MX)
- Comprador/creador **extranjero** → **recibo** (comprobante de pago, NO CFDI, porque el CFDI es solo mexicano).
- **Hoy no hay pagos internacionales** → no existen compras extranjeras que "recibar", y la regla de **quién ve CFDI vs recibo** depende del modelo internacional (¿por país detectado por IP?, ¿por tener RFC mexicano?). Por eso, igual que 6 y 7, **no es cleanly construible todavía**.
- Cuando exista la pasarela internacional: gate del flujo de CFDI a mexicanos + generar el recibo (proof of payment) con el monto en la moneda del comprador.

---

## 🚀 PRODUCCIÓN

### Bloque 9 — Cutover
- Cambiar secreto a **`sk_live`** (agregar `FACTURAPI_LIVE_KEY`).
- Subir el **CSD real de Vibra** a su org (hoy usa RFC de prueba `EIRG710515LI9`; cambiar a la entidad definitiva — marcador `🔁` en `WithdrawFiscalPanel.VIBRA_RECEPTOR`).
- Usar `apikeys/live` para las orgs de creadores (la live solo se entrega al renovar).
- Validación real contra el SAT (en `sk_test` casi todo pasa).

---

## Resumen

| Bloque | Estado | Depende de |
|---|---|---|
| 1 Datos fiscales | ✅ Hecho | — |
| 2 Factura comprador | ✅ Hecho (modo prueba) | — |
| 4 (llave org) | ✅ Desbloqueado | — |
| 3 Creador manual + retiro | ⏸️ | Pasarela + modelo fiscal |
| 4 Creador auto (emisión) | ⏸️ | Pasarela + modelo fiscal |
| 5 Retenciones | ⏸️ | Pasarela + fiscalista |
| 6 Notas de crédito | 🔒 | Bloques 3/4/5 |
| 7 Factura global | 🔒 | Ciclo de emisión |
| 8 Recibo internacional | 🌎 | Pagos internacionales |
| 9 Cutover producción | 🚀 | — (al final) |
