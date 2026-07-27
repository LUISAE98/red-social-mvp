# Política de Verificación de Edad y Protección de Menores de Vibra

> **BORRADOR v0.1 — 2026-07-26. Documento de trabajo; NO sustituye la revisión de un abogado.**
> Fija la edad mínima y el trato de menores. Base: LFPDPPP (menores), **COPPA** (EEUU, <13), **Age‑
> Appropriate Design Code** (Reino Unido) y buenas prácticas. Se apoya en el [T&C](./01-terminos-y-condiciones.md)
> (#1, §7) y el [Aviso de Privacidad](./03-aviso-privacidad-integral.md) (#3). Validar con abogado.
> Ver [README.md](./README.md).
>
> **Placeholders:** `[[CORREO DE SOPORTE]]`, `[[CORREO DE PRIVACIDAD]]`, `[[FECHA DE PUBLICACIÓN]]`.

**Última actualización:** `[[FECHA DE PUBLICACIÓN]]`

---

## 1. Edad mínima

1.1. **Debes tener al menos 18 años** para registrarte o usar Vibra. La Plataforma está diseñada para
personas adultas, dada la monetización, los pagos, las videollamadas 1‑a‑1 y las interacciones directas
entre creadores y audiencia.

1.2. La Plataforma **no está dirigida a menores de edad** y **no permitimos su registro**.

## 2. Cómo verificamos la edad

2.1. **En el registro:** debes declarar tu fecha de nacimiento o confirmar que eres mayor de 18 años. El
registro se bloquea si no se cumple la edad mínima.

2.2. **Creadores (KYC):** al activar la monetización y para retirar fondos, el Creador completa la
**verificación de identidad (KYC)** con documento oficial, lo que confirma su mayoría de edad
(ver [Consentimiento Biométrico](./11-consentimiento-biometrico.md) (#11)).

2.3. **Señales adicionales:** podemos aplicar controles adicionales si detectamos indicios de que una
cuenta pertenece a un menor.

## 3. Qué ocurre si detectamos a un menor

3.1. Si detectamos o recibimos un reporte de que una cuenta pertenece a un **menor de 18 años**,
**suspenderemos o eliminaremos** la cuenta y trataremos sus datos conforme a la ley (incluida su
supresión), sin perjuicio de las obligaciones legales de conservación.

3.2. **Menores de 13 (COPPA).** No recabamos conscientemente datos de menores de 13 años. Si un
padre/madre o tutor detecta que un menor nos proporcionó datos, puede escribir a `[[CORREO DE PRIVACIDAD]]`
para su **eliminación inmediata**.

## 4. Reporte

4.1. Si sabes de una cuenta de un menor o de contenido que ponga en riesgo a menores, repórtalo de
inmediato desde la Plataforma o a `[[CORREO DE SOPORTE]]`. El **material de abuso infantil** se trata con
**tolerancia cero** (Normas de Comunidad §3.1): eliminación, preservación de evidencia y aviso a las
autoridades.

## 5. Diseño apropiado y protección

5.1. Adoptamos medidas razonables de seguridad y privacidad por diseño. `[[Si aplica al público del Reino
Unido/UE, alinear con el Age‑Appropriate Design Code / Children's Code.]]`

## 6. Contenido adulto

6.1. Actualmente la Plataforma **no permite contenido sexual explícito**. `[[Si se habilita contenido
adulto (documento #18), la verificación de edad deberá reforzarse — verificación de edad de los
espectadores por métodos más estrictos que la autodeclaración, según la jurisdicción — antes de dar
acceso a ese contenido.]]`

## 7. Cambios

Podemos actualizar esta política; publicaremos la versión vigente con su fecha.

---

### Anexo — Notas de trabajo (no forma parte de la política publicada)

1. **Brecha G6** del tracker: confirmar/implementar el **gate de edad** (captura de fecha de nacimiento /
   confirmación 18+) en `/register`.
2. **Autodeclaración vs. verificación fuerte:** hoy la edad general es por autodeclaración (estándar de la
   industria para 18+ sin contenido adulto). Si se habilita contenido adulto, se requerirá verificación de
   edad **más estricta** para espectadores (documento #18).
3. **Ubicación:** gate en `/register`; política enlazada en el pie del rail izquierdo y referida en el T&C.
4. Mantener alineado con COPPA/AADC según los mercados donde se opere activamente.
