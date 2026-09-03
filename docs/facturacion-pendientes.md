# Facturación — Estado y pendientes de integración

> Última actualización: 2026-09-02. Fuente de verdad del ESTADO de la facturación (CFDI 4.0, Facturapi).
> La lista de PENDIENTES, en orden de ejecución, vive en `pendientesimpuestos.md` (raíz del repo).
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
- ⚠️ **Mínimo de retiro: era $2,000 MXN.** Hoy son **300 USD** en el tramo estándar y **500 USD**
  en el de wire, desde el corte a la denominación en dólares. Ver `docs/payout-tiers.md`.
- **⚠️ DECISIÓN PENDIENTE — quién absorbe el ~5% de Stripe:** ¿el 23% de Vibra (neto ≈18%), se pasa al comprador, o se descuenta al creador? Define cómo el ledger registra el neto.
- **Liquidación en MXN** (Stripe Adaptive Pricing muestra moneda local al comprador). El CFDI del comprador sigue en MXN.
- **Países / payouts:** en LatAm Stripe solo paga **local en México y Brasil**. Resto de LatAm: el creador abre **Wallbit o Takenos** y cobra en **USD**. → Los creadores se parten en: **mexicano** (CFDI + retenciones MX, Bloques 3/4/5) vs **extranjero** (USD, sin CFDI, **Bloque 8** aplica también a CREADORES).
- **Stripe Tax:** solo calcula/recauda el **IVA de la venta (al comprador)** y valida RFC. **NO** hace retenciones ISR/IVA al creador, **NO** emite CFDI, **NO** reporta al SAT → las **retenciones (Bloque 5) siguen siendo de Vibra + fiscalista**.
- ⚠️ **KYC: la premisa cayó.** Esto asumía Stripe Connect, que trae KYC/KYB gratis. Se eligió
  **Global Payouts**, que no trae ninguno, así que **Didit se quedó** y es el gate del retiro.
- **Reservas/holds de Stripe:** no preguntado aún (otra reunión).
- **Suscripciones recurrentes:** soportadas (Stripe Billing) para membresías de comunidad.
- **Cuenta de prueba (sandbox):** disponible.

**Márgenes (estimado):** 23% comisión − ~5% Stripe − ~8% infra (Mux, CF, Firebase, LiveKit, Vercel, Facturapi) ≈ **~10% neto del GMV**. Los costos de infra son por USO (no % fijo); el riesgo es el video/live/llamadas por peso vendido (rango realista infra ~6–15%).

**Orden al retomar:** 1) integrar Stripe (cobros + Connect + payouts + suscripciones + webhooks), 2) retenciones/fiscal (Bloque 5, con fiscalista), 3) facturas del creador (Bloques 3, 4 y 8).

---

## Estado real — 2026-09-02

**La pasarela ya no es la dependencia.** Stripe está integrado (cobros, Global Payouts, webhooks,
suscripciones) y el flujo de retiro está cerrado y probado. El modelo fiscal está decidido
(intermediación, 2026-08-26) y el motor lo aplica. Lo que queda de facturación es **código propio
y decisiones de contador**, no espera de terceros.

Modo actual: **Facturapi en PRUEBA (`sk_test`)** → todo lo que se timbra es de prueba, **aún no
fiscal**. Y el proceso mensual arranca con `const TIMBRAR = false` en `runCreatorMonthlyDocs.ts`:
calcula y registra el acumulado, pero **no timbra nada**.

> 🔴 **La lista viva de pendientes de impuestos, en orden de ejecución, vive en
> `pendientesimpuestos.md` (raíz del repo).** Este documento describe el ESTADO; aquél dice
> qué se hace primero y por qué.

---

## ✅ HECHO

### Bloque 1 — Datos fiscales
- Perfiles fiscales del **comprador** (varios, tipo "tarjetas guardadas": `users/{uid}/billingProfiles`) con validación de RFC contra el SAT vía Facturapi.
- Perfil fiscal del **creador** (`creatorTaxProfiles`) + subida de **CSD**. ⚠️ Ya **no** es lazy al primer retiro: bajo intermediación el sello se necesita **desde la primera venta**, porque la factura global la emite Vibra con él. El CSD vive en Facturapi, nunca en Firestore.

### Bloque 2 — Factura del comprador
- Selección de movimientos en `/experiencias → Entregados → Todo` + panel `BuyerInvoicePanel`.
- Timbrado del CFDI con **MXN real** cobrado (del `settlementAmount` del `paymentIntents/{id}`; fallback FX si no hay intent).
- **Envío por correo** (PDF+XML) + **descarga de PDF**. Marca `invoiced: true`, no re-facturable.
- Backend: `generateBuyerInvoice`, `downloadBuyerInvoice`.

### Bloque 3 — Flujo de retiro
- **Cerrado y desplegado** (2026-09-01). `requestWithdrawal` / `reviewWithdrawal`, estados
  `pending → approved → sent → paid` (más `rejected` / `failed`), conciliación contra Stripe,
  webhook de eventos v2, devolución de saldo al rechazar, y las ocho notificaciones al creador.
- Las **puertas** del retiro (`motivoDeBloqueo`) exigen KYC, cuenta de cobro y —al mexicano—
  **sello digital vigente**, revalidadas también al aprobar.
- ⚠️ El plan original de este bloque (que el creador subiera PDF+XML de su propia factura a la
  solicitud) **quedó superado por el modelo de intermediación**: el creador ya no le factura a
  Vibra, es Vibra quien le factura a él su comisión.

### Bloque 4 — Comprobantes de Vibra al creador
- `creatorMonthlyDocs.ts`: **CFDI de comisión** (25% + impuesto) y **CFDI de retenciones**
  (constancia), mensuales, agregados por creador. Emisor Vibra, receptor el creador.
- `comprobanteLiquidacion.ts`: **comprobante de liquidación** para el creador extranjero, que no
  es CFDI y por eso se genera **esté o no encendido el timbrado**.
- Llave por organización de Facturapi resuelta (`GET /organizations/{id}/apikeys/test`).

### Bloque 5 — Retenciones
- Cálculo de **ISR/IVA retenidos** según residencia y país de la cuenta de cobro, en
  `backend/src/tax/fiscalEngine.ts`, aplicado **al retirar** (decisión de 2026-08-26), con el
  desglose visible en la wallet.
- `informativaMensual.ts`: los datos de las **dos declaraciones informativas** al SAT
  (retenciones y operaciones), construidos desde los asientos, no desde las constancias.
- 🔴 Falta la **clave de retención correcta**, ver `pendientesimpuestos.md` §A4.

### Bloque 7 — Factura global (parcial)
- `globalInvoice.ts`: agrupa por tipo de servicio y emite **a nombre del creador**, en su
  organización y con su sello.
- **Sin sello no se emite** y se cuenta aparte (`globalesSinSello`); la wallet se lo exige.
- 🔴 Faltan la cadencia (24 h), la marca de las ventas cubiertas y el candado contra el doble
  timbrado. Ver `pendientesimpuestos.md` §A.

---

## 🔴 PENDIENTE

Los detalles, el orden y las dependencias están en **`pendientesimpuestos.md`**. Resumen:

| Grupo | Qué es | Bloquea |
|---|---|---|
| **A** | Cadencia de 24 h, marca de ventas en la global, candado del doble timbrado, clave de retención | Encender `TIMBRAR` |
| **B** | Cola de facturas pendientes, botón desde «Ver detalles» + notificación, cancelación motivo 04, recibo internacional | Que la global salga correcta |
| **C** | Siete preguntas abiertas del contador | Fuera de código |
| **D** | Cutover a producción (`sk_live`, CSD real, `apikeys/live`) | Al final |
| **E** | Elegir el país de la cuenta de cobro desde la interfaz | Menor, hoy mitigado por el KYC |

### Bloque 6 — Notas de crédito
Sigue pendiente y **ya no está bloqueado por 3/4/5**: si una compra ya facturada se reembolsa, hay
que emitir nota de crédito (CFDI de egreso) o cancelar el CFDI. Entra en la cola después del
grupo A, porque comparte máquina con la cancelación motivo 04 (§B7).

---

## Resumen

| Bloque | Estado | Depende de |
|---|---|---|
| 1 Datos fiscales | ✅ Hecho | — |
| 2 Factura comprador | ✅ Hecho (modo prueba) | — |
| 3 Flujo de retiro | ✅ Cerrado 2026-09-01 | — |
| 4 Comprobantes Vibra→creador | ✅ Construido, sin timbrar | `TIMBRAR` |
| 5 Retenciones | ✅ Calculadas y aplicadas | 🔴 clave de retención (A4) |
| 7 Factura global | 🟡 Parcial | 🔴 grupo A |
| 6 Notas de crédito | ⬜ | Grupo A |
| 8 Recibo internacional | ⬜ | — (§B8) |
| 9 Cutover producción | ⬜ | Grupo A + contador |
