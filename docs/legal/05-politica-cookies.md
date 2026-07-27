# Política de Cookies y Tecnologías de Rastreo de Vibra

> **BORRADOR v0.1 — 2026-07-26. Documento de trabajo; NO sustituye la revisión de un abogado.**
> Cubre la política de cookies y los requisitos del **banner de consentimiento**. El banner es
> especialmente exigible para tráfico de la **UE (ePrivacy + GDPR: opt‑in previo para cookies no
> esenciales)**. Se apoya en el [Aviso de Privacidad](./03-aviso-privacidad-integral.md) (#3). Validar
> con abogado y **completar la tabla de cookies con una auditoría real** (ver notas). Ver
> [README.md](./README.md).
>
> **Placeholders:** `[[RAZÓN SOCIAL]]`, `[[CORREO DE PRIVACIDAD]]`, `[[TABLA DE COOKIES REAL]]`,
> `[[HERRAMIENTA CMP]]`, `[[FECHA DE PUBLICACIÓN]]`.

**Última actualización:** `[[FECHA DE PUBLICACIÓN]]`

---

## 1. Qué son las cookies y tecnologías similares

Las **cookies** son pequeños archivos que se almacenan en tu dispositivo cuando visitas la Plataforma.
Usamos también tecnologías similares (almacenamiento local, *tokens* de sesión, píxeles/*web beacons* e
identificadores) para operar el sitio, recordarte y entender su uso. En esta política nos referimos a
todas ellas como "**cookies**".

## 2. Responsable

`[[RAZÓN SOCIAL]]` ("**Vibra**") es responsable del uso de cookies en `https://vibraon.com` y sus
aplicaciones asociadas. Dudas: `[[CORREO DE PRIVACIDAD]]`.

## 3. Categorías de cookies que usamos

Clasificamos las cookies por su finalidad. **Solo las estrictamente necesarias operan sin tu
consentimiento**; las demás requieren tu autorización donde la ley lo exige.

### 3.1. Estrictamente necesarias (no requieren consentimiento)
Indispensables para que la Plataforma funcione. Sin ellas, servicios básicos no operarían.
- **Autenticación y sesión** (p. ej. mantener tu sesión iniciada — Firebase Auth), gestión de sesiones y dispositivos.
- **Seguridad** (prevención de fraude, protección de formularios, balanceo de carga).
- **Preferencias esenciales** (idioma, región, y **memoria de tus preferencias de cookies**).

### 3.2. Funcionales (requieren consentimiento donde aplica)
Mejoran la experiencia y recuerdan tus elecciones.
- Preferencias de interfaz y personalización básica no esencial.

### 3.3. Analíticas / de rendimiento (requieren consentimiento donde aplica)
Nos ayudan a entender cómo se usa la Plataforma para mejorarla (páginas vistas, errores, rendimiento).
- `[[Indicar herramienta real, p. ej. Google Analytics / Firebase Analytics, y si se usa de forma anonimizada.]]`

### 3.4. Marketing / publicidad (requieren consentimiento)
Para mostrar u optimizar comunicaciones y, en su caso, publicidad de contexto cruzado.
- `[[Indicar si se usan; si no se usan, declararlo expresamente. Si se usan, esto activa obligaciones
  adicionales (p. ej. "Do Not Sell or Share" en California — ver Aviso de Privacidad, Anexo B).]]`

## 4. Tabla de cookies

`[[TABLA DE COOKIES REAL — resultado de una auditoría de cookies. Debe listar, por cookie: nombre,
proveedor/dominio, categoría (de la §3), finalidad, y duración/expiración. Ejemplo de formato:]]`

| Cookie | Proveedor | Categoría | Finalidad | Duración |
|--------|-----------|-----------|-----------|----------|
| `[[nombre]]` | `[[dominio]]` | Necesaria | Mantener la sesión | `[[p. ej. sesión / 30 días]]` |
| … | … | … | … | … |

## 5. Base para el uso de cookies y consentimiento

- Las cookies **estrictamente necesarias** se usan con base en el interés legítimo/operación del servicio y **no requieren consentimiento**.
- Las cookies **funcionales, analíticas y de marketing** se usan con base en tu **consentimiento**, que recabamos mediante el **banner** (§6) donde la ley lo exige (especialmente en la UE/EEE).

## 6. Banner de consentimiento (cómo funciona)

6.1. En tu **primera visita** (y cuando lo requiera la ley), te mostramos un **banner de consentimiento**
que permite **Aceptar todas**, **Rechazar todas** (las no esenciales) o **Configurar** por categoría, en
**igualdad de condiciones** (rechazar debe ser tan fácil como aceptar).

6.2. Las cookies **no esenciales no se activan hasta que consientes**. Tu elección se guarda y puedes
**cambiarla en cualquier momento** desde el enlace de "Preferencias de cookies".

6.3. Gestionamos el consentimiento con `[[HERRAMIENTA CMP]]` y conservamos evidencia de tu elección.

## 7. Cómo gestionar o revocar tu consentimiento

- Desde el **panel de "Preferencias de cookies"** de la Plataforma.
- Desde la **configuración de tu navegador** (puedes bloquear o eliminar cookies; algunas funciones podrían dejar de operar si bloqueas las necesarias).
- Señales de exclusión del navegador (p. ej. *Global Privacy Control*), que respetamos donde la ley lo exige.

## 8. Cookies de terceros y transferencias

Algunas cookies son colocadas por **proveedores** (p. ej. de autenticación, analítica o video) que
pueden tratar datos en otros países. Su tratamiento se rige por sus propias políticas y por lo indicado
en nuestro [Aviso de Privacidad](./03-aviso-privacidad-integral.md) (#3), incluyendo las salvaguardas de
transferencias internacionales.

## 9. Cambios a esta política

Podemos actualizar esta política; publicaremos la versión vigente con su fecha de última actualización y,
si el cambio es sustancial, lo señalaremos.

---

### Anexo — Notas de trabajo (no forma parte de la política publicada)

1. **Auditoría de cookies pendiente.** Antes de publicar hay que **escanear la Plataforma** e inventariar
   las cookies reales (nombre, dominio, categoría, finalidad, duración) para llenar la §4. Hoy sabemos con
   certeza de las **necesarias de Firebase Auth**; falta confirmar analítica/marketing.
2. **Decisión de producto:** ¿se usan cookies de **analítica** y/o **marketing/publicidad**? La respuesta
   define si el banner necesita esas categorías y si se activan las obligaciones de "venta/compartición"
   de California (Aviso de Privacidad, Anexo B).
3. **CMP:** elegir e integrar una herramienta de gestión de consentimiento (`[[HERRAMIENTA CMP]]`) que
   bloquee scripts no esenciales hasta el opt‑in y guarde evidencia. Esto es una **función a construir**
   (candidata a sumarse a la sección "Brechas legal ↔ código" del tracker si se decide implementarla).
4. **Ubicación:** banner en la **primera visita** (montado en el layout raíz / `RootChrome`) + página de
   esta política enlazada en el **pie del rail izquierdo** (`OwnerSidebar`).
5. Mantener sincronizado con el Aviso de Privacidad (#3) y la Política de Cookies referida en el T&C (#1).
