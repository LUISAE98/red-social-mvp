# Aviso de Privacidad Simplificado de Vibra

> **BORRADOR v0.1 — 2026-07-26. Documento de trabajo; NO sustituye la revisión de un abogado.**
> Versión **corta** para mostrarse en el **punto de captación** (formulario de registro, `/complete-profile`
> y cualquier formulario que capte datos). Deriva del [Aviso Integral](./03-aviso-privacidad-integral.md)
> (#3) y debe ser consistente con él. Conforme a la **LFPDPPP 2025** (aviso simplificado: identidad del
> responsable, finalidades, y mecanismo para consultar el aviso integral). Validar con abogado.
> Ver [README.md](./README.md).
>
> **Placeholders:** `[[RAZÓN SOCIAL]]`, `[[CORREO DE PRIVACIDAD]]`, `[[URL DEL AVISO INTEGRAL]]`.

---

## Versión para mostrar en pantalla (texto listo para el formulario)

**Aviso de Privacidad**

`[[RAZÓN SOCIAL]]` ("**Vibra**") es responsable del tratamiento de tus datos personales.

Usamos tus datos para **crear y operar tu cuenta, prestarte los servicios de la Plataforma, procesar
tus pagos y monetización, verificar tu identidad cuando corresponda, dar seguridad y moderación, y
cumplir obligaciones legales y fiscales** (finalidades necesarias). Con tu consentimiento, también los
usamos para **marketing, personalización y analítica** (finalidades voluntarias), que puedes negar sin
afectar el servicio.

Algunos servicios tratan **datos sensibles** (verificación de identidad y grabación de sesiones), para
los que recabamos tu **consentimiento expreso** en el momento correspondiente.

Puedes conocer las finalidades completas, las transferencias, tus **derechos ARCO** y cómo ejercerlos,
y la forma de limitar el uso de tus datos, en nuestro **Aviso de Privacidad Integral**:
**`[[URL DEL AVISO INTEGRAL]]`**. Dudas: `[[CORREO DE PRIVACIDAD]]`.

---

## Versión ultra‑corta (una línea, junto al checkbox de registro)

> Al registrarte aceptas los [Términos y Condiciones](./01-terminos-y-condiciones.md) y confirmas que
> leíste el [Aviso de Privacidad]([[URL DEL AVISO INTEGRAL]]). Debes tener **18 años o más**.

---

### Notas de implementación (no forma parte del aviso publicado)

1. **Dónde va:** debe estar **visible en el mismo formulario** de `/register` y `/complete-profile`, no
   solo enlazado en el footer. La LFPDPPP exige que el aviso esté disponible **desde el momento en que se
   recaban los datos**.
2. **Enlace al integral:** `[[URL DEL AVISO INTEGRAL]]` debe apuntar a la página del documento #3.
3. **Consentimiento sensible:** este aviso corto **no** basta para KYC ni grabaciones; esos consentimientos
   específicos se recaban en su propio flujo (#10, #11).
4. **Registro de aceptación** (brecha **G4** del tracker): guardar versión del aviso + timestamp cuando el
   usuario se registra.
5. Mantener sincronizado con el #3: si cambian las finalidades, actualizar ambos.
