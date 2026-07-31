# Facturación — Estado y pendientes de integración

> Última actualización: 2026-07-30. Fuente de verdad del avance de facturación (CFDI 4.0, Facturapi).
> Modelo: **Vibra VENDEDOR DIRECTO** (seller of record). Detalle fiscal en `docs/legal/fiscal-iva-isr-plataforma.md`.

## Dependencia principal

**La pasarela de pago (procesadora) todavía no está definida** (dLocal rechazó; se evalúa Pagsmile/EBANX). De ella dependen el **modelo fiscal real** (IVA, ISR, **retenciones**) y los **pagos internacionales**. Por eso la mayoría de los bloques pendientes **esperan a la pasarela** — no es que falte el código, es que aún no sabemos las reglas fiscales/monto exactas.

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
