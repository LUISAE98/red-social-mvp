# Niveles de retiro y comisión por país

> Decidido por Luis el 2026-08-27. **Fuente de verdad** de la comisión y del mínimo de retiro.
> Sustituye al 25% plano con mínimo de 300 USD para todos.
>
> Base de cálculo en `docs/stripe-integracion.md` §8-sexies (comisiones reales de Global Payouts)
> y §3 (comisiones de cobro).

---

## La regla, en una frase

**25% de comisión y retiras desde 300 USD. En los países donde la transferencia bancaria es
cara, 30% y retiras desde 500 USD.**

| Ruta | Comisión | Mínimo | Países |
|---|---|---|---|
| Stripe, transferencia local | 25% | 300 USD | 46 |
| Stripe, solo wire | 30% | 500 USD | 27 |
| **Wallbit** | **25%** | **300 USD** | **12** |
| Territorios por cuenta ajena | 25% | 300 USD | 4 |
| Sin ruta de pago | — | — | 58 |

**89 países pagables de 147.**

---

## Por qué dos grupos y no doce

El coste de Stripe por país va del **3.40% al 14.73%** — once puntos de diferencia. Con comisión
plana, un creador en un país caro dejaba a Vibra menos de la mitad de margen que uno en Estados
Unidos.

Lo que separa a los dos grupos no es el porcentaje sino **el método de transferencia**:

* **Transferencia local** — 1.50 USD fijos. El fijo es tan pequeño que el mínimo casi no
  cambia nada: subirlo de 300 a 700 ahorra **0.29 puntos**. No compensa la fricción.
* **Wire** — 25 USD fijos. Aquí el mínimo lo es todo: subirlo de 300 a 500 ahorra **3.33
  puntos**, once veces más. Por eso solo este grupo tiene mínimo alto.

Con esta regla, **lo que le queda a Vibra cae entre 18.14% y 20.10%** en los doce niveles de
coste, contra un rango de once puntos antes.

### Lo que se descartó, y por qué

**Comisión distinta por país (25%–30% en doce escalones).** Resolvía el tramo pequeño —entre
Europa y México hay un punto— y no el grande: a 30% sobre un coste de 14.73% se queda por debajo
de Estados Unidos a 25%. Habría hecho falta 35%. Y costaba doce niveles en la interfaz, en los
contratos y en 47 idiomas, más la conversación de *«¿por qué mi amigo peruano paga más?»*.

**Mínimo de 700 para los países de coste medio.** Compraba 0.29 puntos a cambio de pedir más del
doble de acumulado. El ahorro no justificaba la barrera.

---

## Qué se le pide a cada creador

> Actualizado el 2026-08-27, con las dos rutas de pago.

| | Todos | Stripe | Wallbit | Mexicano |
|---|---|---|---|---|
| **1. Identidad (Didit)** | ✅ | ✅ | ✅ | ✅ |
| **2a. Alta de cuenta Stripe** | | ✅ | ❌ | ✅ |
| **2b. Datos de Wallbit** | | ❌ | ✅ | |
| **3. Datos fiscales + CSD** | | | | ✅ |

El **KYC de Didit es de los 89 países pagables**, sin excepción. Lo que cambia después es
por dónde cobra y si tiene que emitir CFDI.

El tercer paso aparece cuando el **país del documento del KYC** o el **país de la cuenta de
cobro** dicen México. Basta con que una de las dos lo diga. No se pregunta: una respuesta se
puede equivocar, un pasaporte no.

---

## Los grupos, país por país

> **Cobertura de Stripe verificada preguntándole a la API país por país**, no leyendo la
> documentación. El script está en `scripts/sondearPayouts.sh`. Cobertura de Wallbit según
> `paiseswallbit.md`.

### Stripe, transferencia local — 25%, mínimo 300 USD (46)

1.50 USD fijos por envío. Es la ruta más barata que hay.

```
MX AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK CR DO NO IS AU ID NZ SG CA US PE GB MA TT JM MC SM CI
```

### Stripe, solo wire — 30%, mínimo 500 USD (27)

25 USD fijos por envío. Sobre un retiro de 300 USD serían más del 8%, y por eso son los
únicos con comisión y mínimo distintos.

```
BA HK QA KW JP MY PH TH JO TW ZA EG TR RS AL MD VN AE LC AG LK BT BN MN BW NG KH
```

### Wallbit — 25%, mínimo 300 USD (12)

Países donde Stripe no llega, o donde solo llega por wire. El creador cobra en una cuenta
de Wallbit en dólares.

```
AR BR BO CO GT PA EC SV CL UY PY HN
```

⚠️ **En CL, UY, PY, HN Wallbit NO tiene retiro a banco local.** El creador cobra en dólares y su
única salida documentada es cripto. Se incluyen por decisión de producto del 2026-08-27 —la
alternativa era no pagarles nada— y se les avisa en el alta, antes de que acumulen saldo.

🔁 Si Wallbit confirma que tiene tarjeta de débito, o abre retiro local ahí, se quita la
marca `soloDolares` y el aviso desaparece solo.

### Territorios que cobran con la cuenta de otro país (4)

| Código | Territorio | Cobra como |
|---|---|---|
| `PR` | Puerto Rico | Estados Unidos |
| `VI` | Islas Vírgenes de EE. UU. | Estados Unidos |
| `IC` | Islas Canarias | España |
| `EA` | Ceuta y Melilla | España |

### Sin ruta de pago (58)

⚠️ **Compran y venden, pero nadie les puede pagar.** Ni Stripe ni Wallbit llegan.

🚨 **Esto NO les quita el impuesto.** Siguen en los 147 de la tabla fiscal, siguen pagando el
IVA de su país y siguen generando su factura. Lo único que no pueden es cobrar.

Lista para hoja de cálculo: **`docs/paises-sin-ruta-de-pago.tsv`**.

```
NI GU PG NC FJ ME KR SA PF TO SB VU WS KI NR TV NU WF FM MH AS MP SR BZ GD KY BM TC VG HT BQ VC KN DM AI MS GL PM JE AD FO GI VA GG SJ AZ NP MV NF CX CC TK PN GF YT GP MQ RE
```

Los únicos con mercado real son **Nicaragua, Corea del Sur, Arabia Saudita, Nepal, Haití,
Papúa Nueva Guinea y Azerbaiyán**. El resto son islas y territorios de menos de cien mil
habitantes.

## Reglas de aplicación

**El nivel lo decide el país de la cuenta de cobro del creador**, no su residencia fiscal ni su
IP. Es el país al que de verdad viaja el dinero.

**Al cambiar de nivel se respeta la comisión de las ventas ya hechas.** Si un creador se muda o
cambia de banco, sus ventas anteriores conservan la comisión que tenían. Recalcular hacia atrás
destruye la confianza y es lo primero que se nota en el saldo.

**La comisión se congela en el asiento del ledger**, igual que las retenciones, para que una
venta vieja siempre se pueda explicar.

---

## Lo que hay que decirle al creador

Antes de activar la monetización, y otra vez antes del primer retiro:

* Su comisión y su mínimo, en su moneda.
* Que el mínimo existe porque **la transferencia a su país cuesta más**, no como castigo.
* Que si cambia su cuenta a otro país, puede cambiarle el nivel **de ahí en adelante**.

⚠️ Esto entra en el Acuerdo de Creador (§4) y en los Términos (§35), que hoy dicen 25% plano.

---

## Lo que cuesta cada retiro

> Añadido el 2026-08-31. El tarifario vivía solo en `docs/stripe-integracion.md` §8-sexies,
> y este documento —que es la fuente de verdad de los tramos— no lo tenía.

```
1.50 USD fijo  +  0.25% transfronteriza  +  1% conversión a moneda local
```

**Transferencia local**, los 46 del tramo estándar:

| Retiro | Fijo | Transfronteriza | Conversión | Coste | % del retiro |
|---|---|---|---|---|---|
| 100 USD | 1.50 | 0.25 | 1.00 | 2.75 | **2.75%** |
| **300 USD** ← mínimo | 1.50 | 0.75 | 3.00 | **5.25** | **1.75%** |
| 500 USD | 1.50 | 1.25 | 5.00 | 7.75 | 1.55% |
| 1,000 USD | 1.50 | 2.50 | 10.00 | 14.00 | 1.40% |

**Wire**, los 27 del tramo caro. 25 USD fijos por envío:

| Retiro | Coste | % del retiro |
|---|---|---|
| 300 USD | 25.00 | 8.33% |
| **500 USD** ← mínimo | 25.00 | **5.00%** |
| 1,000 USD | 25.00 | 2.50% |

Ahí está el porqué de los dos mínimos: subirlo de 300 a 500 ahorra **3.33 puntos** en wire y
solo **0.29** en local.

⚠️ **La transfronteriza no es 0.25% en todos.** México, Estados Unidos, Reino Unido y Canadá
están en el tramo barato. Hay países al 1% y Perú al 1.25%, lo que sobre 300 USD lleva el
coste de 1.75% a 2.50% y 2.75%.

⚠️ Stripe cobra estas comisiones **de la cuenta financiera**, no las descuenta del envío. Hace
falta saldo para el pago Y para su comisión, o el envío falla.

🔴 **De Wallbit no hay ni una tarifa medida.** Sus 12 países llevan 25% y 300 USD por analogía
con la transferencia local de Stripe. Ver el pendiente 3 de `paiseswallbit.md`.

---

## Referencia: el coste total, payin más payout

Peor caso, comprador con tarjeta internacional (payin 4.4%):

| Grupo | Coste Stripe | Le queda a Vibra |
|---|---|---|
| Estándar, a 300 USD | 4.90% – 7.15% | **18.14% – 20.10%** |
| Transferencia cara, a 500 USD | 10.40% – 11.40% | **18.60% – 19.60%** |

Con tarjeta estadounidense (payin 2.9%) el coste baja 1.5 puntos en todos.

⚠️ **Estas dos filas se calcularon con el payout de Connect** (~0.5%), no con el 1.75% real de
Global Payouts. El extremo bajo del estándar debería ser **6.15%**, no 4.90%, y lo que le queda
a Vibra baja algo más de un punto. Rehacer con las cifras de arriba.

⚠️ **El desglose de los «doce niveles de coste» del 3.40% al 14.73% no está escrito en ningún
documento del repo.** Solo sobrevivió el rango, citado más arriba en este mismo archivo. Si
hay que volver a justificar los tramos, hay que rehacerlo desde la tabla oficial de Stripe.

---

## Estado de la implementación

Actualizado el 2026-08-27. Los bloques son los de `docs/stripe-integracion.md` §8-octies.5.

| | Bloque | Estado | Dónde |
|---|---|---|---|
| **A** | Tabla de niveles por país | ✅ Rehecha con la tabla oficial de Stripe | `backend/src/wallet/payoutTiers.ts` + espejo `lib/wallet/payoutTiers.ts` + `backend/test/payoutTiers.pure.test.ts` |
| **B** | País de la cuenta en el perfil | ✅ | Lo escribe el alta de Stripe (`globalPayoutsRecipient.ts`) |
| **C** | Congelar la comisión en el asiento | ✅ | `backend/src/wallet/ledger.ts` — `commissionRate`, `commissionTier`, `payoutCountry` |
| **D** | Los archivos que mostraban el 75% | ✅ | `lib/wallet/useCreatorNetRate.ts`, adoptado en 20 archivos |
| **E** | Gate del retiro | ✅ | `useCreatorTaxProfile` + `wallet/finanzas` — mínimo propio, cuenta de cobro y país pagable |
| **F** | Contárselo en 47 idiomas | ⬜ | Falta el copy que explica **por qué** su mínimo es más alto |
| **G** | Backfill | ✅ | Innecesario: los asientos viejos ya llevan `commissionRate: 0.25` escrito |

### Las tres reglas, y dónde se cumplen

| Regla | Dónde se cumple |
|---|---|
| Decide el país de la **cuenta de cobro** | `payoutTermsOf(perfil.payoutAccountCountry)` en el ledger |
| Un país sin fila **no es 25%, es no pagable** | `payoutTermsOf` devuelve `null`; el gate no abre y se avisa en Finanzas |
| **No recalcular hacia atrás** | La comisión se congela en el asiento; `netRateOfEntry` lee la del asiento, nunca la actual |

### Lo que cambia de comportamiento

🔴 **El gate del retiro exige ahora cuenta de cobro y país pagable.** Antes bastaba con la
identidad (y el sello si era mexicano), así que un creador podía pedir un retiro sin destino.
Mientras nadie tenga cuenta dada de alta, nadie retira — que es la verdad, no una regresión.

⚠️ **Un creador sin país de cuenta cobra al 25%.** La venta ya se cobró al comprador y el
asiento no se puede rechazar; entre las dos comisiones, la benigna para él es la baja.

### Pendiente

🔴 Los **58 países sin ruta de pago** siguen pudiendo vender. Ya se les avisa en Finanzas, pero
la decisión de fondo —impedir monetizar o buscar otra vía— sigue abierta.
