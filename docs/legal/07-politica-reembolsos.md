# Política de Reembolsos y Cancelaciones de Vibra

> **BORRADOR v0.1 — 2026-07-26. Documento de trabajo; NO sustituye la revisión de un abogado.**
> Regula reembolsos, cancelaciones y el derecho de desistimiento por tipo de Servicio. Debe mostrarse
> **en cada checkout** (antes de pagar) y enlazarse en el pie del rail izquierdo. Base: LFPC/PROFECO
> (México), Directiva 2011/83 + 2019/770 (UE, con la **excepción de contenido digital**), y reglas de
> renovación automática (FTC/EEUU). Se apoya en el [T&C](./01-terminos-y-condiciones.md) (#1, Parte VII).
> Validar con abogado. Ver [README.md](./README.md).
>
> **Placeholders:** `[[PLAZO REEMBOLSO, p. ej. X días hábiles]]`, `[[TOLERANCIA NO‑SHOW, p. ej. 10 min]]`,
> `[[CORREO DE SOPORTE]]`, `[[FECHA DE PUBLICACIÓN]]`.

**Última actualización:** `[[FECHA DE PUBLICACIÓN]]`

---

## 1. Marco general

1.1. Vibra actúa como **intermediario**: el Servicio lo presta el Creador. Esta política define cuándo
procede un reembolso o cancelación y cómo solicitarlo.

1.2. **Naturaleza digital.** La mayoría de los Servicios son de **contenido/servicios digitales de
ejecución inmediata**. Para ellos, cuando la ley reconoce un derecho de desistimiento, este **se pierde**
si consientes expresamente el inicio de la ejecución y reconoces esa pérdida (se recaba en el checkout).

1.3. **Derechos irrenunciables.** Nada en esta política limita los derechos que la LFPC (México) o las
normas imperativas de la UE/EEUU reconozcan al consumidor.

## 2. Reembolsos por tipo de Servicio

### 2.1. Saludos, consejos y mensajes personalizados
- **Reembolso total** si el Creador **rechaza** la solicitud o **no entrega** dentro del plazo ofrecido.
- Una vez **entregado conforme a lo solicitado**, no procede reembolso por arrepentimiento.
- Si lo entregado no corresponde a lo solicitado o incumple, procede reembolso o corrección.

### 2.2. Sesiones exclusivas y meet & greet (1‑a‑1)
- **No‑show del Creador** o cancelación sin causa: **reembolso total** o reprogramación.
- **No‑show del Comprador** tras la tolerancia de `[[TOLERANCIA NO‑SHOW]]`: el Servicio puede considerarse
  prestado y **no reembolsable**.
- Falla técnica imputable a la Plataforma que impida la sesión: reembolso o reprogramación.

### 2.3. Membresías / suscripciones (renovación automática)
- Puedes **cancelar en cualquier momento**, de forma **tan sencilla como te suscribiste**; conservas el
  acceso hasta el final del periodo pagado.
- **No** se reembolsan de forma prorrateada los periodos ya iniciados, salvo que la ley lo exija o exista
  falla imputable a la Plataforma/Creador.
- Los **cargos por renovación** posteriores a la cancelación se reembolsan si la cancelación fue previa a
  la renovación y aun así se cobró.

### 2.4. Contenido premium y acceso a VOD
- Al ser contenido digital de acceso inmediato, **no es reembolsable una vez consumido/accedido**, salvo
  defecto, error de cobro o indisponibilidad imputable al Creador o a la Plataforma.

### 2.5. Entradas a eventos / sesiones en vivo de pago
- **Cancelación del evento** por el Creador o la Plataforma: reembolso o reprogramación.
- Cancelación por el Comprador: sujeta a las condiciones publicadas del evento.

### 2.6. Supercomentarios
- Salvo **error de cobro**, **no reembolsables**. Si se retiran por moderación **por causa imputable al
  Usuario**, no generan derecho a reembolso.

### 2.7. Propinas y donaciones (perfil y en vivo)
- **Voluntarias y no reembolsables**, salvo **error** (p. ej. cobro duplicado o monto equivocado por falla
  del sistema).

## 3. Errores de cobro, cobros duplicados y fallas

3.1. Si detectas un **cargo erróneo, duplicado o no reconocido**, contáctanos en `[[CORREO DE SOPORTE]]`
**antes** de iniciar un contracargo (§5). Corregiremos los errores comprobados.

## 4. Cómo solicitar un reembolso

4.1. Envía tu solicitud desde la Plataforma o a `[[CORREO DE SOPORTE]]`, indicando la compra, la fecha y
el motivo. Podemos pedir información para verificarla.

4.2. Los reembolsos aprobados se procesan al **método de pago original** (o al Saldo, según corresponda)
en un plazo aproximado de `[[PLAZO REEMBOLSO]]`, sujeto a los tiempos del Proveedor de Pagos.

## 5. Contracargos

5.1. Iniciar un **contracargo** sin intentar antes una solución puede retrasar la resolución. El uso
indebido de contracargos ("fraude amistoso") puede derivar en suspensión de la cuenta y retención de
Saldos relacionados (T&C §42).

## 6. Efecto de los reembolsos en el Creador

6.1. Un reembolso puede implicar el **ajuste o descuento** del importe correspondiente en el Saldo del
Creador y de las comisiones asociadas (T&C §44).

## 7. Cambios

Podemos actualizar esta política; publicaremos la versión vigente con su fecha.

---

### Anexo — Notas de trabajo (no forma parte de la política publicada)

1. **Dónde va:** visible **en cada checkout** (`ServicePaymentModal`, overlays de saludo/sesión) **antes de
   pagar**, y enlazada en el pie del rail izquierdo.
2. **Brecha G9** del tracker: el **flujo de reembolsos generales** está pendiente de implementar; esta
   política define la regla, falta la función.
3. **Renuncia al desistimiento (UE):** para contenido digital de ejecución inmediata, capturar en el
   checkout el consentimiento + reconocimiento de pérdida del derecho de 14 días.
4. Definir los valores reales de `[[PLAZO REEMBOLSO]]` y `[[TOLERANCIA NO‑SHOW]]` con producto.
5. Mantener alineada con las reglas por Servicio del T&C (Parte VII) y con la Wallet (#8).
