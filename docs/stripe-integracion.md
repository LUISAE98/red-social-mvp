# Stripe — Referencia de integración (Vibra)

> Compilado el 2026-07-30 desde la documentación de Stripe (docs.stripe.com), organizado por sector.
> Objetivo: resolver dudas desde aquí durante la migración Mercado Pago → Stripe.
> ⚠️ Los detalles finos (fees exactos, listas de países, plazos T+X) **verificar directo con Stripe / dashboard** antes de asumir como definitivo — aquí se captura el "cómo funciona" y las decisiones/dudas.

Decisiones Vibra ya tomadas (ver `docs/facturacion-pendientes.md` y memoria de pagos):
- **Stripe Connect**, plan "Tú controlas los precios", **Vibra = vendedor directo (Merchant of Record)**.
- **Modelo agregador (Opción B):** todo cae en Vibra; Vibra paga al creador (1–2 payouts/mes).
- **Mínimo de retiro: $2,000 MXN.** Liquidación en MXN.
- Payout local solo **MX y BR**; resto LatAm cobra en **USD** vía Wallbit/Takenos.

---

## 1. Flujo de dinero — **Separate Charges and Transfers**

Es el modelo que corresponde a nuestro agregador (Opción B):

```
Comprador → Cargo en la plataforma (Vibra)   ← el dinero cae TODO en Vibra
Vibra retiene su comisión
Al final del ciclo (1–2/mes) → Transfer a la cuenta del creador
```

- **`application_fee`**: la comisión que retiene la plataforma (nuestro 23%, o el neto tras decidir quién absorbe el ~5% de Stripe). Se debita solo del cargo.
- **`transfer`**: movimiento SEPARADO del cargo, de nuestro saldo → cuenta del creador. Lo iniciamos NOSOTROS cuando el creador retira. Puede ser parcial/total y a múltiples creadores.
- **Comerciante en el extracto del comprador**: **Vibra** (correcto, somos vendedor de registro). NO usar `on_behalf_of` (pondría al creador como comerciante, y además cross-border no lo soporta).

**Mapea a hoy:** reemplaza a `chargeServiceIntent` (MP Orders) + el `settlementAmount`. El "retiro" (Bloque 3) se vuelve un `transfer` de Stripe.

---

## 2. Cuenta del creador (Connect account)

- El creador es una **cuenta conectada**. Stripe hace su **KYC/KYB** (nombre, fecha nac., ID oficial, comprobante domicilio, datos bancarios) — **incluido/gratis en Connect**.
- ⚠️ **NO cubre verificación de EDAD** — solo identidad/negocio. Si Vibra requiere gate de edad, eso es aparte (¿ahí sigue teniendo sentido Didit para edad?).
- **Tipos de cuenta:** Stripe hoy recomienda **Accounts v2 / "controller properties"** en vez de los tipos heredados. Pragmático: **Express** (Stripe hospeda el onboarding/KYC, nosotros controlamos precios/transfers/disputas). Onboarding con **hosted onboarding** (formulario de Stripe) o componentes embebidos.
- **Reemplaza a Didit** como gate de retiros: Stripe hace ID + documento + liveness + **AML/sanciones** + banco, y **NO habilita el payout hasta que pase** → es el gate por sí mismo, Didit queda redundante.
- ⚠️ **Lo que Didit sí hace y Stripe NO:** (a) **detección de duplicados** (misma cara/persona en varias cuentas — evita fraude de multi-cuentas; hoy manejamos `DUPLICATED_FACE`/`POSSIBLE_DUPLICATED_USER`); (b) **verificación de edad de compradores** (Stripe solo pide fecha de nac. del creador). Si esas 2 señales importan, resolverlas aparte antes de quitar Didit.

**Mapea a hoy:** reemplaza el gate KYC de Didit + `payoutAccounts` (la CLABE la captura Stripe en el onboarding). Didit a bajo volumen es gratis (500/mes), así que quitarlo es simplificación, no ahorro urgente.

---

## 3. Payouts (Stripe → banco)

Hay que distinguir **dos cosas**:
1. **Transfer** (Vibra → cuenta del creador): lo controlamos nosotros (cuando el creador retira, 1–2/mes).
2. **Payout** (saldo de la cuenta del creador → su banco): schedule (automático diario/semanal/mensual, o manual).

- **Schedule** configurable por cuenta; **Brasil siempre diario**. Settlement speed T+X varía por país.
- **Mínimo de transferencia** por defecto = 1 unidad de la moneda; nosotros ponemos **mínimo de negocio $2,000 MXN**.
- **Saldo negativo de plataforma**: si reembolsos > cargos, Stripe debita nuestro banco → el banco debe aceptar débitos.
- Eventos: `payout.paid`, `payout.failed`.

---

## 4. Pagos internacionales / Cross-border — ⚠️ PARCIAL (hay un candado de KYC)

**Lo que Stripe confirmó:** se pueden hacer payouts a **cuentas conectadas en 46 países, incluido USA** → un creador extranjero con cuenta **US** (Wallbit/Takenos) puede recibir.

**El candado (investigado 2026-07-30, evidencia contradictoria):**
- Wallbit/Takenos venden que basta **pegar el banco US + ID local + W-8BEN** en Stripe.
- Pero **Fourthwall** (otra plataforma Stripe) dice que **Stripe exige que el país de residencia coincida con el del banco**, y que **bancos US "virtuales" NO funcionan** (ellos usan bill.com).
- **Reconciliación probable:** el punto es la IDENTIDAD, no el banco. Una cuenta Stripe **US de individuo pide SSN**; un extranjero sin SSN puede NO pasar solo con banco US. **La ruta robusta = LLC US + EIN** (Wallbit tiene alianza "Defentux" para formar LLCs) → la cuenta conectada se crea como **empresa US** y pasa KYB con EIN + pasaporte.

**Conclusión:** NO asumir que "banco US = resuelto". **Probar de verdad** con una cuenta Wallbit/Takenos real (personal vs LLC) en nuestro Connect antes de prometer el flujo. Posible requisito real: **LLC US + EIN** para el creador extranjero.

Implicación fiscal (no cambia): creador extranjero se paga en USD, **sin CFDI** (proveedor extranjero) → Bloque 8. Mexicano → MXN + CFDI + retenciones.

**Plan:** construir primero el flujo **mexicano** (sin este candado); agregar la rama internacional después de probar el KYC US.

Fuentes: [Wallbit – cobrar de Kick](https://www.wallbit.io/es/blog/get-paid-from-kick) · [Fourthwall – país no soportado](https://help.fourthwall.com/frequently-asked-questions/payments-and-pricing/country-not-supported-by-stripe) · [Wallbit–Defentux LLC](https://www.wallbit.io/en/blog/wallbit-defentux-alliance)

---

## 5. Suscripciones (membresías de comunidad) — Stripe Billing

- Objetos: **Product** (la membresía) → **Price** (monto/moneda/frecuencia) → **Subscription** (cliente+price) → **Invoice** automática cada ciclo.
- **Estados**: `trialing`, `active`, `past_due`, `unpaid`, `canceled`, etc.
- **Reintentos inteligentes (Smart Retries / dunning)** ante pago fallido (configurable).
- **Con Connect**: se cobra al miembro y se retiene comisión con `application_fee_amount` por factura.
- **Prorrateo** al cambiar de plan; cancelación inmediata o al fin de ciclo.
- Eventos: `invoice.paid` (dar acceso), `invoice.payment_failed` (reintento/avisar), `customer.subscription.deleted` (cancelar acceso).

**Mapea a hoy:** reemplaza `payGroupSubscription` (Preapproval de MP) por Stripe Billing.

---

## 6. Reembolsos

- Total o parcial (varios parciales por cargo).
- **Las comisiones de Stripe NO se devuelven** en un reembolso → **decidir quién absorbe ese costo** en un refund.
- **En Connect (separate charges & transfers):** el reembolso sale del **saldo de la plataforma**; hay que **revertir la transferencia** al creador manualmente (`reverse transfer`) para recuperar su parte. El `application_fee` se reembolsa (o es configurable).
- Acreditación al comprador: ~5–10 días hábiles.
- Eventos: `charge.refunded`, `refund.updated`, `refund.failed`.

**Relevante para Bloque 6 (nota de crédito):** un reembolso de algo ya facturado seguirá necesitando su nota de crédito CFDI (aparte de Stripe).

---

## 7. Disputas / contracargos

- El comprador disputa con su banco → **Stripe revierte el pago y debita** el monto + **fee de disputa** (~**150 MXN** según lo que te dijeron; verificar por red).
- Se responde con **evidencia** (texto+imágenes) en el Dashboard según el código de motivo.
- **Umbrales de tasa de disputa**: las redes (Visa/MC) tienen programas de monitoreo; pasar el umbral trae sanciones. Bienes digitales = ojo.
- Herramientas: **Radar** (antifraude por transacción), **Smart Disputes**, Verifi/Ethoca.

---

## 8. Riesgo y reservas (⚠️ responde la duda pendiente de "holds")

**Clave:** en modelo **marketplace / cargos indirectos** (separate charges & transfers), **la PLATAFORMA (Vibra) es responsable de los saldos negativos**, NO Stripe. Y por eso:
- **Stripe PUEDE retener RESERVAS sobre el saldo de la plataforma.** (Esto es el "reservas/holds" que faltaba preguntar — la respuesta base es: sí, como marketplace, el riesgo y las posibles reservas caen en Vibra.)
- Fuentes de saldo negativo: reembolsos, contracargos, fraude.
- Mitigación (nuestra responsabilidad): **retener reservas a cuentas de creador de alto riesgo, suspender pagos/transfers mientras se investiga, KYC riguroso, Radar en todas las transacciones.**
- "Managed Risk" (que Stripe gestione) **no aplica** cuando la plataforma es la responsable (nuestro caso).

→ **Duda concreta para Stripe:** ¿nos pondrán una **reserva rodante** inicial por ser vertical de creadores/streaming, de cuánto y por cuánto tiempo?

---

## 9. Webhooks (hay que rehacer toda la capa)

- Stripe manda POST a nuestro endpoint; respondemos **2xx rápido** y procesamos async.
- **Verificar firma** con el `signing secret` (`whsec_...`) — obligatorio (si no, cualquiera falsifica eventos).
- **Idempotencia**: guardar `event.id` procesados (Stripe reintenta ~3 días; puede duplicar).
- Eventos clave a manejar:
  - Pagos: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
  - Suscripciones: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
  - Payouts/transfers: `payout.paid`, `payout.failed`, `transfer.created`, `transfer.reversed`.
  - Connect (cuenta del creador): `account.updated` (cambios de verificación/capacidades).
- Probar local con `stripe listen --forward-to`.

**Mapea a hoy:** reemplaza `mpWebhook`.

---

## 10. Métodos de pago MX + guardar tarjeta

- Habilitar métodos desde el Dashboard (sin contratos). **Verificar disponibilidad en MX de:** tarjetas (sí), **OXXO** (efectivo), **SPEI** (transferencia) — confirmar en la guía por región.
- **Guardar tarjeta para cobros futuros/recurrentes**: `Customer` + `PaymentIntent`/`SetupIntent` con método reutilizable (off-session). Necesario para suscripciones y para el "un-clic".
- Construir el método con **Stripe.js/Elements** (PCI, datos sensibles nunca tocan nuestro server).

**Mapea a hoy:** reemplaza los "saved cards" de MP (`paymentMethods`, Customers & Cards de MP) por `Customer` + PaymentMethods de Stripe.

---

## 11. Preguntas abiertas para Stripe (siguiente reunión)

1. ~~Cross-border a creadores extranjeros~~ ✅ **RESUELTO**: payouts a cuentas conectadas en 46 países incl. USA (Wallbit/Takenos).
2. **Reservas/holds:** ¿reserva rodante inicial por ser vertical de creadores/streaming? ¿monto y duración?
3. **Fee de disputa exacto** por red y **umbral de tasa de disputa** tolerado.
4. **Settlement speed (T+X) en México** y frecuencia de payout de nuestro propio balance.
5. **OXXO / SPEI** disponibles y sus costos.
6. **Cuenta v2 (controller properties) vs Express** — cuál recomiendan para nuestro caso (vendedor de registro + creadores MX y extranjeros).
7. **KYC / anti-duplicados:** ¿Connect detecta si una persona abre **varias cuentas de creador** (misma identidad/cara)? Si no, ¿cómo lo cubrimos al quitar Didit?

---

## 12. Resumen de qué se reconstruye (MP → Stripe)

| Hoy (Mercado Pago) | Con Stripe |
|---|---|
| `chargeServiceIntent` (Orders) | Cargo en plataforma (Separate charges & transfers) |
| `settlementAmount` (MXN) | Monto del cargo / balance |
| `mpWebhook` | Webhooks de Stripe (verificados) |
| Saved cards (Customers & Cards MP) | `Customer` + PaymentMethods (Stripe.js) |
| `payGroupSubscription` (Preapproval) | Stripe Billing (subscriptions) |
| Retiro (por cablear) | `transfer` a cuenta conectada + payout |
| Gate KYC Didit | KYC de Connect (menos edad) |
| `payoutAccounts` (CLABE) | Capturada en onboarding de Connect |
