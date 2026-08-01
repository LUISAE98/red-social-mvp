# Vibra — Modelo financiero (comisión, comisiones de Stripe y márgenes)

> Creado 2026-07-31. Fuente de verdad del esquema de comisión/márgenes. Los % de Stripe se validaron con un cobro real de prueba (ver `docs/stripe-integracion.md`).

## Comisión y reparto
- **Comisión Vibra: 25%** (subió de 23% para cubrir devoluciones + sueldos y mantener 10% de utilidad).
- **Reparto: Creador 75% / Vibra 25%** (antes 77/23). El creador recibe 75% de la base.

## Quién absorbe cada costo
| Costo | Lo cubre | Detalle |
|---|---|---|
| **$3 fijo por cobro** | **Comprador** | Protege el margen en cobros chicos (donde el fijo es brutal). |
| **FX del cobro (~2%)** | **Comprador** | Vía Stripe **Adaptive Pricing**: al comprador extranjero se le presenta el precio en su moneda con el margen de cambio incluido; Vibra liquida en MXN completo. Solo aplica a compradores extranjeros. |
| **Stripe payin (%)** | **Vibra** | Tarjeta MX **3.6%** · tarjeta extranjera **4.1%** (3.6% + 0.5% intl). Sobre el total cobrado. |
| **Stripe payout (%)** | **Vibra** | 0.25% + $12/transferencia + $35/mes cuenta activa. Con retiro a $10,000 → **0.72%**. |
| **FX del payout (MXN→USD)** | **Banco del creador** | NO lo absorbe Vibra — lo aplica el banco/fintech del creador (Wallbit/Takenos) al convertir a USD. Confirmado en junta con Stripe. |
| **Retenciones ISR/IVA del creador** | **Creador** | MX: vía CFDI (Facturapi). Extranjero: en su país. |

- **IVA (16%) que Stripe suma a sus comisiones:** acreditable para Vibra (se recupera) → no cuenta en el costo económico.

## Payout
- **Mínimo de retiro: $10,000 MXN** → tarifa barata (0.72%). Vibra absorbe ese %.
- **Opción de retiro anticipado** (desde $2,000): el **creador absorbe** el % más alto del payout (a $2,000 = 2.6%). Así el que quiere su dinero ya paga por la prisa; el que espera, gana la tarifa barata.
- El costo del payout (0.25% + $12 + $35) lo absorbe Vibra en el retiro estándar de $10,000.

## Márgenes objetivo (a escala)
```
25% comisión =
   ~5%  Stripe        (payin ~4% + payout 0.72%)
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
- Ejemplo trazado (base $100, comprador MX): buyer paga $119 (base+IVA+$3); Stripe % que Vibra absorbe ≈ $4.3; payout absorbido ≈ $0.55; **Vibra neto ≈ $18/base = ~18–20%** antes de devoluciones/sueldos.

## Decisiones registradas
- **D1** — Comprador absorbe **$3 fijo + 2% FX** del cobro. ✅
- **D-comisión** — Comisión **25%** (reparto 75/25). ✅
- **D-payout-mín** — **$10,000** para tarifa barata + retiro anticipado (desde $2,000) que absorbe el creador. ✅
- **D-payout-FX** — El FX del payout lo cubre el **banco del creador**, no Vibra. ✅
- **D-payout-Vibra** — Vibra absorbe payin% + payout% → objetivo 25% → 5% Stripe + 8% infra + 1% dev + 1% sueldos + 10% utilidad. ✅
