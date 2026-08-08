# Impuestos — base de programación por país

> Registro único de **cómo queda programado y justificado** el cobro de impuestos en cada país
> que Vibra habilita. Una ficha por país. Nada se programa sin su ficha aquí.
>
> Marco legal completo: `docs/legal/fiscal-iva-isr-plataforma.md`.
> Tabla de cobro (código): `backend/src/tax/config.ts` (autoritativa) + `lib/tax/config.ts` (espejo display).
>
> Última actualización: **2026-08-07**

---

## 1. Los cuatro conceptos de toda transacción

Todo cobro de Vibra, en cualquier país, se compone de exactamente cuatro piezas:

| # | Concepto | Naturaleza | ¿Se le muestra desglosado al comprador? |
|---|---|---|---|
| 1 | **Precio base** del creador | Ingreso (base del reparto 75/25) | No |
| 2 | **$3 MXN fijos** por transacción | Cargo de servicio de Vibra | No |
| 3 | **2% por conversión de moneda** | Costo/comisión, **NO es impuesto** | No |
| 4a | **Impuesto del país del comprador** | Impuesto | No |
| 4b | **IVA mexicano de la venta de Vibra** | Impuesto | No |

**Decisión de producto:** la pasarela muestra **un solo precio total, sin desglose**. El $3 y el 2%
van incluidos y convertidos a la moneda del comprador, sin explicación en la UI.

> ⚠️ **El desglose no se muestra, pero SIEMPRE se guarda.** Cada `paymentIntent` registra las
> cinco piezas por separado. Sin eso no se puede timbrar un CFDI, ni responder una auditoría, ni
> recalcular cuando el fiscalista cambie un criterio.
>
> **Excepción legal obligatoria:** si un comprador **mexicano** pide factura, el CFDI **debe**
> desglosar el IVA por separado. Eso es requisito de forma del CFDI, no de la UI, y no contradice
> el precio todo-incluido de la pasarela.

---

## 2. Orden de operaciones (invariable)

```
base                       # precio del creador, en MXN
+ 3 MXN                    # FIXED_SERVICE_FEE_MXN
= published                # sobre esto corre el reparto y el impuesto
+ 2% FX                    # solo si la moneda de cobro ≠ MXN
= taxableAmount            # base gravable
+ impuesto del país        # solo si collectionMode = "platform"
+ IVA mexicano             # 16% si el comprador está en MX; 0% export si está fuera
= chargedAmount            # total, en MXN canónico
→ × tipo de cambio         # solo para MOSTRAR en la moneda del comprador
```

**Por qué el 2% va ANTES del impuesto:** el cargo por conversión es parte de la contraprestación
que cobra Vibra, así que forma parte de la base gravable. No es un impuesto y nunca se declara
como tal.

**MXN es la moneda canónica.** El ledger, la wallet y el `paymentIntent` viven en MXN
(`SETTLEMENT_CURRENCY`). La moneda local es solo capa de presentación y de cobro.

---

## 3. Cómo se determina el país del comprador

### 3.1 🚨 El agujero que hay que cerrar ANTES de agregar el segundo país

Hoy el `taxCountry` **lo manda el cliente** y el backend solo lo valida con `isChargeableCountry`.
Eso funciona por accidente: como **solo México está configurado**, cualquier otro país es
rechazado y no hay evasión posible.

**El día que Argentina exista en la tabla con impuesto 0, ese accidente se acaba:** un comprador
mexicano manda `taxCountry: "AR"`, pasa la validación y **paga 0% en vez de 16%**. Vibra es quien
responde ante el SAT por ese IVA no cobrado.

> **Regla dura: la determinación del país pasa a ser 100% server-authoritative antes de habilitar
> el segundo país. No es opcional ni se puede dejar para después.**

### 3.2 Base legal — Art. 18-C LIVA (los 4 indicios)

El receptor de un servicio digital se considera **en territorio nacional** cuando:

| # | Indicio | De dónde se obtiene |
|---|---|---|
| 1 | Domicilio manifestado en territorio nacional | Dirección de facturación (Stripe) |
| 2 | Pago mediante intermediario en territorio nacional | **País emisor de la tarjeta (BIN)**, vía Stripe |
| 3 | IP en el rango asignado a México | IP del request, **leída en el servidor** |
| 4 | Teléfono con código de país de México | Teléfono del perfil |

### 3.3 Regla de decisión

La norma está redactada de forma **conservadora hacia México**, y la implementación la respeta:

1. **Si CUALQUIER indicio apunta a México → el comprador es mexicano.** Se cobra 16%. Sin
   excepciones. Es la lectura segura del 18-C y elimina el incentivo a falsear la ubicación.
2. **Solo si NINGÚN indicio apunta a México** se evalúa el país extranjero.
3. Entre indicios extranjeros en conflicto, **gana el país emisor de la tarjeta** — es el más
   difícil de falsificar y es el que la propia autoridad puede corroborar.
4. Si el país resultante **no tiene ficha en este documento** → se rechaza el cobro.
5. **Los 4 indicios se guardan siempre** en el `paymentIntent`, aunque coincidan. Son la evidencia
   ante una auditoría.

### 3.4 El problema de los dos momentos

El país de la tarjeta **solo se conoce al pagar**, pero el precio se muestra **antes**. Por eso hay
dos fases y no una:

| Fase | Qué se usa | Naturaleza |
|---|---|---|
| **Display** (catálogo, botón, pasarela) | IP + cookie `vibra_country` | **Estimado.** Nunca autoritativo |
| **Cobro** (confirmación del intent) | IP del request en servidor + país de la tarjeta | **Autoritativo.** Es el que manda |

Si al confirmar el total cambia respecto al mostrado, **se re-confirma con el comprador antes de
cobrar**. Nunca se cobra en silencio un monto distinto al que vio.

---

## 4. Modelo de datos

### 4.1 Configuración por país

```ts
/** Quién recauda materialmente el impuesto del país del comprador. */
type TaxCollectionMode =
  | "platform"   // Vibra lo cobra en el checkout y lo entera (MX)
  | "issuer"     // lo percibe la emisora/banco del comprador (AR, CR, PY)
  | "none";      // sin régimen aplicable → país NO cobrable

/** Régimen del IVA MEXICANO sobre la venta de Vibra (Vibra es residente en MX). */
type MxVatTreatment =
  | "domestic_16"     // comprador en México
  | "export_zero"     // comprador fuera → 0% por exportación (Art. 29-IV)
  | "export_taxable"; // comprador fuera pero el servicio NO encuadra → 16% al margen

type CountryTaxConfig = {
  taxName: string;            // "IVA", "IGV", "ITBIS", "ITBMS", "ISV"…
  taxRate: number;            // 0.21 — se guarda SIEMPRE, aunque no se cobre
  currency: string;           // moneda local de cobro
  collectionMode: TaxCollectionMode;
  mxVatTreatment: MxVatTreatment;
};
```

**Por qué `taxRate` se guarda aunque no se cobre:** para poder advertirle al comprador argentino
qué le va a sumar su banco, y para reconstruir la operación si el criterio cambia.

**Por qué `mxVatTreatment` es un campo y no una constante:** hoy es `export_zero` en todos los
países extranjeros. Si el fiscalista dictamina que algún servicio o país no encuadra en el
Art. 29-IV, se cambia **una línea** y los 8 intents lo heredan. Ver **D-08**.

### 4.2 Registro por transacción (`paymentIntents`)

```ts
{
  // Determinación del país — evidencia Art. 18-C
  buyerCountry: "AR",
  buyerCountrySource: "card_bin",           // card_bin | ip | billing_address | phone
  buyerCountryIndicios: {
    billingAddress: "AR" | null,
    cardCountry:    "AR" | null,
    ipCountry:      "AR" | null,
    phoneCountry:   "AR" | null,
  },

  // Composición del precio (todo en MXN canónico)
  baseAmount:        100.00,
  fixedFee:            3.00,
  publishedAmount:   103.00,
  fxFeeRate:          0.02,
  fxFeeAmount:         2.06,
  taxableAmount:     105.06,

  // Impuesto del país del comprador
  buyerTax: {
    name: "IVA", rate: 0.21, amount: 0,
    collectionMode: "issuer",
    note: "Lo percibe la emisora argentina (RG 4240/18). Vibra no lo cobra ni lo entera.",
  },

  // IVA mexicano de la venta de Vibra
  mxVat: { treatment: "export_zero", rate: 0, amount: 0, article: "29-IV" },

  chargedAmount:     105.06,   // MXN
  settlementCurrency: "MXN",
  displayCurrency:   "ARS",
  fxRate:            <tipo de cambio del día>,
}
```

**Importes inmutables:** el `paymentIntent` congela tasa de impuesto y tipo de cambio. Nunca se
reconstruye un histórico con la config vigente.

---

## 5. Reglas invariables

1. **Nunca cobrar un impuesto que ya recauda un tercero.** Si `collectionMode = "issuer"`, el
   checkout suma **cero**. Cobrarlo sería doble imposición al comprador.
2. **Nunca confiar en el cliente** para el país fiscal. Server-authoritative siempre.
3. **Cualquier indicio hacia México gana.** Ante la duda, 16%.
4. **Nunca colapsar los dos impuestos en un solo campo**, aunque los dos den cero. Son
   independientes y se mueven por separado.
5. **País sin ficha en este documento → no cobrable.**
6. **El 2% de FX no es impuesto.** No se declara, no se entera, no se llama impuesto en ningún lado.
7. **Advertencia obligatoria** en países `issuer`: el checkout debe avisar qué sumará el banco.
   Sin eso, el sobresalto llega en el resumen de tarjeta y se convierte en contracargo.

---

## 6. Fichas por país

### 🇲🇽 México — `MX` · ✅ EN PRODUCCIÓN

| Campo | Valor |
|---|---|
| Impuesto | IVA **16%** |
| Moneda de cobro | MXN |
| `collectionMode` | `platform` — Vibra cobra y entera |
| `mxVatTreatment` | `domestic_16` |
| Registro | Vibra ya es contribuyente mexicano |

**Cobro:** `(base + 3) × 1.16`. Sin 2% de FX (moneda = moneda de liquidación).

**Justificación:** operación doméstica. Vibra es residente en México (Art. 16 LIVA) y vende a un
comprador en territorio nacional. Causa IVA al 16%, que Vibra traslada, cobra y entera.

**Facturación:** si el comprador pide factura, CFDI con IVA desglosado. Si no, comprobante de pago
no fiscal + factura global mensual.

---

### 🇦🇷 Argentina — `AR` · 🟡 DISEÑADO, SIN PROGRAMAR

| Campo | Valor |
|---|---|
| Impuesto | IVA **21%** |
| Moneda de cobro | ARS *(⚠️ decisión abierta, ver abajo)* |
| `collectionMode` | **`issuer`** — lo percibe la emisora |
| `mxVatTreatment` | `export_zero` |
| Registro en Argentina | **No requerido** |

**Cobro de Vibra:** `(base + 3) × 1.02`. **Cero impuesto agregado por Vibra.**

**Justificación del impuesto argentino — RG 4240/18 (ARCA/AFIP):** los agentes de percepción son
*"las entidades del país que faciliten o administren los pagos al exterior"*. El proveedor digital
del exterior — Vibra — **no tiene obligación de registrarse, cobrar ni ingresar nada** en
Argentina. Si Vibra cobrara el 21% en su checkout, el comprador lo pagaría **dos veces**.

**Justificación del IVA mexicano al 0%:** venta de residente mexicano aprovechada en el
extranjero → exportación de servicios a tasa 0% (Art. 29-IV LIVA). **Provisional**: pendiente de
que el fiscalista confirme el inciso por servicio (**D-08**) y el requisito de pago (Art. 58 RLIVA).
Si dictamina que no encuadra, se cambia `mxVatTreatment` a `export_taxable` y el 16% sale del
margen de Vibra — **nunca se le traslada al comprador argentino**.

**Lo que el comprador ve en su resumen de tarjeta**, sobre un precio de 100 de Vibra:

| Concepto | Quién lo agrega | Monto |
|---|---|---|
| Precio de Vibra (incluye $3 y 2%) | Vibra | 100 |
| IVA 21% — RG 4240/18 | Emisora | +21 |
| Percepción 30% a cuenta de Ganancias/Bienes Personales — RG 5617 | Emisora | +30 |
| IIBB provincial, si aplica | Emisora | +0 a ~5 |
| **Total en su resumen** | | **~151–156** |
| **Lo que recibe Vibra** | | **100** |

⚠️ **Implicación de negocio:** el precio se infla ~51% para el argentino y Vibra no ve un peso de
esa diferencia. Decidir si eso cambia la estrategia de precios para AR.

**Decisión abierta — ¿cobrar en ARS o en MXN/USD?** Cambia si aplica la percepción del 30%
(que golpea consumos en moneda extranjera) y si Stripe liquida directo. De eso depende el campo
`currency` de esta ficha.

---

## 7. Estado y pendientes

### Países

| País | Estado |
|---|---|
| 🇲🇽 México | ✅ En producción |
| 🇦🇷 Argentina | 🟡 Diseñado, sin programar |
| Los otros 17 (16 LatAm + USA + Canadá) | ⬜ Sin ficha — **no cobrables** |

### Bloqueantes antes de habilitar el segundo país

1. 🚨 **Determinación server-authoritative del país** (§3.1). Sin esto, agregar Argentina abre una
   vía de evasión del IVA mexicano.
2. **Cablear el 2% de FX.** `FX_CONVERSION_FEE`, `shouldAddFxFee` y `fxFeeRateForCountry` están
   definidos en los dos espejos de config y **no se invocan en ningún lado**. Hoy no se cobra nada
   por conversión.
3. **Agregar `collectionMode` y `mxVatTreatment`** al tipo y a `applyConsumptionTax`.
4. **Aviso en el checkout** para países `issuer`.

### Decisiones abiertas

| ID | Qué | Quién |
|---|---|---|
| **D-08** | Mapear los 11 servicios a un inciso del Art. 29-IV. Provisionalmente **todos a 0%**; los dudosos son **Tiempo contigo** y **Sesión exclusiva** | Fiscalista MX |
| **D-09** | Investigación profunda país por país (19) | Luis + fiscalista internacional |
| **AR-01** | ¿Cobrar en ARS o en MXN/USD? | Luis + Stripe |

---

## 8. Plantilla para países nuevos

```markdown
### 🏳️ País — `XX` · ⬜ ESTADO

| Campo | Valor |
|---|---|
| Impuesto | NOMBRE **X%** |
| Moneda de cobro | XXX |
| `collectionMode` | platform / issuer / none |
| `mxVatTreatment` | export_zero |
| Registro en el país | Sí / No / Umbral |

**Cobro de Vibra:** fórmula exacta.
**Justificación del impuesto local:** norma citada + fuente oficial.
**Justificación del IVA mexicano:** encuadre Art. 29-IV.
**Lo que el comprador ve:** tabla del resumen.
**Decisiones abiertas:** …
```
