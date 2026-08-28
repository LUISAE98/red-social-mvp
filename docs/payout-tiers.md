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

| Grupo | Comisión | Mínimo de retiro | Países |
|---|---|---|---|
| **Estándar** | 25% | 300 USD | 45 |
| **Transferencia cara** | 30% | 500 USD | 29 |
| Sin ruta de pago | — | — | 73 |

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

## Los grupos, país por país

### Estándar — 25%, mínimo 300 USD (45)

Ordenados del más barato al más caro para Vibra:

| Coste de Stripe | Países |
|---|---|
| El más bajo | US |
| Muy bajo | AT BE BG CY CZ DE EE ES FI FR GB GR HR IE IS IT LT LU LV MT NL PT SI SK |
| Bajo | CA HU MX NO SE |
| Medio | DK ID JM MA NZ PL SG TT · MC SM |
| Medio-alto | RO · AU CR DO · PE |

### Transferencia cara — 30%, mínimo 500 USD (29)

| Países |
|---|
| EC PA SV · HK TH ZA · TR |
| AE AG AL BA BN BT BW EG GT JO JP KW LC LK MD MN MY PH QA RS TW VN |

### Sin ruta de pago (73)

⚠️ **Pueden comprar y pueden vender, pero Global Payouts no llega.** Incluye **Brasil,
Argentina, Colombia, Chile, Uruguay, Paraguay, Bolivia**, Corea del Sur, Arabia Saudita,
Nigeria, Honduras, Nicaragua y Puerto Rico.

```
AD AI AR AS AZ BM BO BQ BR BZ CC CI CL CO CX DM EA FJ FM FO GD GF GG GI GL GP GU HN HT IC
JE KH KI KN KR KY ME MH MP MQ MS MV NC NF NG NI NP NR NU PF PG PM PN PR PY RE SA SB SJ SR
TC TK TO TV UY VA VC VG VI VU WF WS YT
```

🔴 **Decisión pendiente:** o se impide monetizar desde estos países, o se busca otra vía de
pago. Hoy un creador brasileño puede vender y acumular saldo que **nadie puede sacarle**.

---

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

## Referencia: el coste que hay detrás

Peor caso, comprador con tarjeta internacional (payin 4.4%):

| Grupo | Coste Stripe | Le queda a Vibra |
|---|---|---|
| Estándar, a 300 USD | 4.90% – 7.15% | **18.14% – 20.10%** |
| Transferencia cara, a 500 USD | 10.40% – 11.40% | **18.60% – 19.60%** |

Con tarjeta estadounidense (payin 2.9%) el coste baja 1.5 puntos en todos.

---

## Estado de la implementación

Actualizado el 2026-08-27. Los bloques son los de `docs/stripe-integracion.md` §8-octies.5.

| | Bloque | Estado | Dónde |
|---|---|---|---|
| **A** | Tabla de niveles por país | ✅ | `backend/src/wallet/payoutTiers.ts` + espejo `lib/wallet/payoutTiers.ts` + `backend/test/payoutTiers.pure.test.ts` |
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

🔴 Los **73 países sin ruta de pago** siguen pudiendo vender. Ya se les avisa en Finanzas, pero
la decisión de fondo —impedir monetizar o buscar otra vía— sigue abierta.
