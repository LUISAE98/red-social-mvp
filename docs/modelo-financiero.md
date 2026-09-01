# Vibra — Modelo financiero (comisión, comisiones de Stripe y márgenes)

> Creado 2026-07-31. Fuente de verdad del esquema de comisión/márgenes. Los % de Stripe se validaron con un cobro real de prueba (ver `docs/stripe-integracion.md`).

> ⚠️ **ACTUALIZADO 2026-08-26 al modelo de INTERMEDIACIÓN.** El 25% dejó de ser *margen* sobre una venta
> propia y **vuelve a ser una comisión** por intermediar la venta del creador. Cambia el asiento contable
> y añade el IVA de la comisión. Ver `docs/legal/fiscal-iva-isr-plataforma.md` §0 y §5.

## Comisión y reparto

> ⚠️ **YA NO ES PLANA (2026-08-27).** Son dos grupos según el país de la cuenta de cobro del
> creador. Fuente de verdad: **`docs/payout-tiers.md`**.
>
> Lo que le queda a Vibra va de **18.46%** (comprador internacional, creador peruano) a
> **22.56%** (comprador estadounidense, creador en país de wire). Los 24 casos en
> `docs/stripe-integracion.md` §4-bis.
>
> | Grupo | Comisión | Mínimo de retiro | Países |
> |---|---|---|---|
> | Estándar (transferencia local de Stripe) | **25%** | 300 USD | 46 |
> | Transferencia cara (wire de Stripe) | **30%** | 500 USD | 27 |
> | Wallbit, con y sin retiro local | **25%** | 300 USD | 12 |
> | Sin ruta de pago | — | — | 58 |
>
> **89 países pagables de 147.** Conteos actualizados el 2026-08-31 desde
> `backend/src/wallet/payoutTiers.ts`. Los anteriores (45 / 29 / 73) eran de antes de que
> entrara Wallbit el 2026-08-27.
>
> Con esa regla, lo que le queda a Vibra cae entre **18.46% y 22.56%**, contra un rango de once
> puntos con comisión plana. Desglose caso por caso en `docs/stripe-integracion.md` **§4-bis**.

- **Comisión Vibra: 25% u 30%** sobre el precio base según el grupo (subió de 23% para cubrir
  devoluciones + sueldos y mantener 10% de utilidad).
- **Reparto: Creador 75% / Vibra 25%.** El creador conserva el 75% de la base, íntegro antes de sus
  propias retenciones.
- **El IVA de la comisión va POR ENCIMA del 25%, nunca dentro.** Con creador mexicano la comisión es
  25 + 16%. Si fuera dentro, la comisión efectiva caería a **21.55%** y Vibra absorbería un impuesto que
  no puede acreditar — **3.45 puntos regalados por venta**.
- **Ingreso contable de Vibra = su comisión**, no el 100% del precio. El 75% del creador nunca fue
  ingreso: transitó por cuenta ajena.

## Quién absorbe cada costo
| Costo | Lo cubre | Detalle |
|---|---|---|
| **0.40 USD fijo por cobro** | **Comprador** | Protege el margen en cobros chicos (donde el fijo es brutal). ⚠️ Eran **$3 MXN** hasta el corte a la denominación en USD. Los 0.40 son los 0.30 del fijo de Stripe en EE. UU. + 0.05 de Radar, con el margen que exige que Stripe cobre su porcentaje también sobre ese cargo (mínimo real 0.361 nacional, 0.370 internacional). Constante `FIXED_SERVICE_FEE_USD`. |
| **FX del cobro (2%)** | **Comprador** | ❌ NO es Stripe Adaptive Pricing (esa función es solo para Checkout/Prices fijos; nosotros usamos PaymentIntents dinámicos). **La conversión la hacemos NOSOTROS**: convertimos el precio del creador (USD) → moneda local del comprador con nuestro FX **+ 2%**, y cobramos en esa moneda local. El 2% cubre el spread de conversión de Stripe al liquidar a USD. Va ANTES del impuesto, porque es contraprestación de Vibra y forma parte de la base gravable. Ver `docs/stripe-integracion.md §13` y `backend/src/tax/composeCharge.ts`. |
| **Stripe payin (%)** | **Vibra** | **2.9% + 0.30 USD**, más **1.5%** si la tarjeta no es estadounidense y **1%** más si hay conversión. Sobre el total cobrado. ⚠️ Eran 3.6% / 4.1% con la entidad mexicana; estas son las tarifas de Vibra On, LLC en EE. UU. |
| **Stripe payout** | **Vibra** | **1.50 USD fijos + transfronteriza + conversión.** La transfronteriza tiene **cinco tramos del 0.25% al 1.25%** según destino, y la conversión es **0.50%** entre dólar, euro y libra, **1%** el resto y **0%** si el creador ya cobra en dólares. Sobre el mínimo de 300 USD va de **0.50%** (EE. UU.) a **2.75%** (Perú); México son 1.75%. Por wire son **25 USD fijos** más los porcentajes, un 4.5–4.9% sobre el mínimo de 500. Tabla país por país en `lib/wallet/payoutFees.ts`. ⚠️ Stripe las cobra **de la cuenta financiera**, no las descuenta del envío: hace falta saldo para el pago Y su comisión. |
| **FX del payout (USD→moneda local)** | **Vibra** | ⚠️ **Se invirtió con el corte a USD.** Antes el ledger vivía en pesos y el creador extranjero pagaba la conversión; hoy el ledger vive en USD y el **1% de conversión de Global Payouts lo absorbe Vibra**, incluido en el 1.75% del retiro. 🔴 Quién convierte de USD a MXN y a qué tipo de cambio **no está decidido ni escrito en el código**. |
| **Retenciones ISR/IVA del creador** | **Creador** | MX: vía CFDI (Facturapi). Extranjero: en su país. |

- **IVA (16%) que Stripe suma a sus comisiones:** acreditable para Vibra (se recupera) → no cuenta en el costo económico.

## Payout

> ⚠️ **Reescrito el 2026-08-31.** Este bloque estaba entero en pesos y con las tarifas de
> Connect. El retiro anticipado nunca se construyó.

- **Mínimo de retiro: 300 USD** en el tramo estándar y **500 USD** en el de wire. Fuente de
  verdad `backend/src/wallet/payoutTiers.ts` (`minWithdrawalUsd`).
- **El coste del retiro lo absorbe Vibra, siempre.** Al creador le llega su 75% íntegro, y de
  ahí solo salen sus propias retenciones fiscales. Decisión de §8-sexies.4.
- **El mínimo alto solo existe para el wire.** En transferencia local el fijo de 1.50 USD es
  tan pequeño que subir el mínimo de 300 a 700 ahorra 0.29 puntos; en wire, subirlo de 300 a
  500 ahorra 3.33 puntos. Once veces más.
- **El coste es regresivo.** A 100 USD el retiro local cuesta 2.75%; a 300, 1.75%; a 1,000,
  1.40%. El mínimo cae justo donde la curva se aplana.
- 🗑️ **El retiro anticipado se descartó.** La idea era dejar sacar desde un monto bajo
  cobrándole al creador el porcentaje más alto. No se construyó y no está en el código.

🔴 **Wallbit no tiene tarifa medida.** Sus 12 países llevan 25% y 300 USD por analogía con la
transferencia local de Stripe. Falta una cuenta de prueba y un retiro real contra el tipo
mid-market. Ver el pendiente 3 de `paiseswallbit.md`.

## Márgenes objetivo (a escala)
```
25% comisión =
   2.9–9.4%  Stripe    (payin 2.89–4.48% + payout 0–4.90%)   <- era ~5% con el payout de Connect
    8%  Operatividad  (Mux, Cloudflare, Firebase, LiveKit, Vercel, Facturapi)
    1%  Devoluciones / contracargos
    1%  Sueldos y otros
   10%  UTILIDAD
──────
= 25%
```

## Notas / advertencias
- **"8% de infra" es estimado** (rango real 6–15%), sensible al consumo de video/live/llamadas por peso vendido. Medir por creador al arrancar.
- **"1% de sueldos" es un costo FIJO**, no un % real por transacción. Al inicio (poco volumen) los sueldos son mucho más del 1% del GMV; a escala, menos. El **10% de utilidad es objetivo "a escala"**, no del día 1.
- **Comisión escalonada:** considerar tarifa menor para creadores de alto volumen, para retener a los grandes (competencia tipo Kick con 5%).
- Ejemplo trazado (base 100 USD, comprador y creador mexicanos): el comprador paga **118.80**
  (100 + 0.40 de fijo + 2.01 de FX + 16.39 de IVA); al creador le llegan **76.50**, de los que
  8.00 son IVA que declara él; Vibra ingresa **27.41** (fijo + FX + comisión) y entera **14.89**
  al fisco. Las tres columnas suman el total cobrado. De esos 27.41 sale el coste de Stripe.
  Cifras generadas con `lib/tax/fiscalEngine.ts`, no a mano.

## Decisiones registradas
- **D1** — Comprador absorbe el **cargo fijo + 2% FX** del cobro. ✅ *(el fijo eran $3 MXN, hoy son 0.40 USD)*
- **D-comisión** — Comisión **25%**, o **30%** en los 27 países de solo wire. ✅ *(dejó de ser plana el 2026-08-27)*
- **D-payout-mín** — **300 USD** estándar y **500 USD** wire. ✅ *(eran $10,000 MXN; el retiro anticipado se descartó y nunca se construyó)*
- **D-payout-FX** — El FX del payout lo cubre **Vibra**. ✅ ⚠️ **Se invirtió con el corte a USD**
  (2026-08-18) y esta línea se quedó diciendo lo contrario hasta el 2026-08-31. Cuando el ledger
  vivía en pesos, el creador extranjero pagaba la conversión al recibir dólares; hoy el ledger
  vive en dólares y es Vibra quien paga a Stripe la conversión a la moneda del creador. La fila
  de «Quién absorbe cada costo» de arriba es la buena.
- **D-payout-Vibra** — Vibra absorbe payin% + payout% → objetivo 25%. ⚠️ El reparto original (5% Stripe + 8% infra + 1% dev + 1% sueldos + 10% utilidad) daba por buenos **0.72% de payout**; con Global Payouts son **1.75%**, así que el punto de más sale de la utilidad. Rehacer el objetivo. ✅ la decisión, ⬜ el reparto.
