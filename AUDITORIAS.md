# Auditorías de seguridad — Vibra

Registro de las auditorías de seguridad por bloques y de lo que queda pendiente.

Última actualización: **2026-08-14** (bloques 1, 2 y 3 cerrados)

---

## Pendientes

Tres cosas siguen abiertas. Ninguna es un hallazgo sin arreglar — son pasos que dependen de la consola o de una decisión de producto.

### 1. Diagnosticar App Check y activar la exigencia

**Estado:** bloqueado. Es lo único que impide dar el Bloque 1 por cerrado.

App Check está **integrado y desplegado** en el cliente (`lib/appCheck.ts`), con la clave de reCAPTCHA v3 en Vercel. El overlay de OBS también lo monta (`public/live-overlay.html`), porque es el único cliente de Vibra que habla con Firestore fuera del bundle de Next.

Lo que falta es **activar la exigencia** en Firestore, Storage y Cloud Functions, o sea que empiecen a rechazar peticiones sin token válido.

**No se puede activar todavía.** La consola marcaba `0% verificadas / 100% no verificadas` en Firestore. Con ese número, exigir dejaría fuera al 100% del tráfico y tumbaría la aplicación.

**Diagnóstico pendiente.** Abrir `vibraon.com` en incógnito con DevTools:

- Pestaña **Network**, filtrar por `appcheck`.
- Buscar la petición a `firebaseappcheck.googleapis.com/.../exchangeRecaptchaV3Token`.

| Resultado | Significado |
|---|---|
| `200` | Todo bien, solo retraso de métricas. Esperar 24 h y volver a mirar |
| `400` o `403` | El cuerpo de la respuesta dice la causa exacta |
| No aparece ninguna | App Check no arranca. Revisar la Console del navegador |

**Sospecha principal:** que la clave registrada sea de **reCAPTCHA Enterprise** en vez de **v3 clásico**. El código usa `ReCaptchaV3Provider`, que no acepta una clave Enterprise y falla en silencio — se vería exactamente como ese 0%. Comprobar en <https://www.google.com/recaptcha/admin> que la clave figura como **v3** y que `vibraon.com` está en sus dominios.

**Orden seguro para activar, cuando el porcentaje se acerque al 100%:**

1. Firestore y Storage desde la consola de App Check.
2. Las callables desde código (`enforceAppCheck: true`).

Nunca al revés, y nunca antes de ver el porcentaje.

---

### 2. Verificación en dos pasos exigible para moderadores

**Estado:** cubierto en la práctica, no exigible.

Corresponde al hallazgo **H07** del Bloque 2. Los moderadores entran con Google, y si esas cuentas tienen la verificación en dos pasos activada, ya hay segundo factor. Pero **Vibra no puede exigirlo ni comprobarlo**: el token que recibe no dice si hubo segundo factor, así que un moderador con la verificación apagada entraría igual.

Ya está cerrado todo lo demás de la gestión de moderadores:

- El claim de moderador exige sesión de Google en las reglas **y** en las callables, no solo en el cliente.
- Dar o quitar el rol revoca los tokens al instante (`scripts/set-moderator.ts`).
- Los cambios de rol quedan registrados en `adminAuditLog`.

**Dos caminos para cerrarlo:**

- **Gratis y suficiente:** si las cuentas de Google de moderación viven en un Google Workspace propio, obligar la verificación en dos pasos desde su consola de administración. Lo hace cumplir Google en vez de Vibra, pero es exigible y auditable.
- **Completo:** subir a **Identity Platform**, que permite exigir MFA desde Firebase. Es el mismo salto que haría falta para la revocación de sesiones por dispositivo y, posiblemente, para la política de contraseñas.

---

### 3. Separar el rol de supermoderador (H04 del Bloque 3)

**Estado:** aplazado por decisión de producto. **No hacer todavía.**

Hoy una sola persona con el claim `role=moderator` puede moderar contenido, aprobar devoluciones de dinero, disparar reembolsos de Stripe y ejecutar healthchecks que manejan secretos. No hay separación entre moderador de contenido, soporte, finanzas y operador técnico.

Se decidió dejarlo así **mientras el equipo sea Luis y poca gente de confianza**. Cuando entre gente nueva a moderar contenido, conviene partirlo en al menos dos roles: uno que solo toca contenido y otro que puede tocar dinero.

Lo que ya se cerró alrededor, y reduce mucho el riesgo mientras tanto:

- El supermoderador **ya no puede leer toda la base de datos**. Ve contenido, reportes y solo las conversaciones privadas que alguien denunció. No ve datos fiscales, bancarios, wallets, sesiones ni claves de transmisión.
- Todas las funciones privilegiadas, incluidas las de dinero, exigen claim **más** sesión de Google (`backend/src/authz.ts`).

### 4. Exigir correo verificado para entrar

**Estado:** aplazado a propósito. **No hacer todavía.**

Corresponde al hallazgo **H02** del Bloque 2, que se excluyó de la auditoría por decisión de producto: la verificación de correo al crear cuenta está desactivada para poder usar cuentas de prueba sin verificar cada una.

Hoy el registro **envía** el correo de verificación, pero la cuenta queda autenticada y entra a la plataforma sin comprobar nada. No existe ninguna comprobación de `emailVerified` ni en el cliente, ni en las Firestore Rules, ni en las Cloud Functions.

**Cuando se active, hay que decidir dónde se corta el paso**, porque no es solo una casilla:

- ¿Se bloquea el acceso entero, o solo las acciones sociales (publicar, comentar, crear comunidades)?
- ¿Qué pasa con las cuentas ya creadas sin verificar?
- Las cuentas de Google llegan con el correo ya verificado por el proveedor, así que solo afecta al registro por correo y contraseña.
- El sitio natural para exigirlo en el servidor es `notAnonymous()` o una función hermana en las reglas, más el guard de rutas en `RootChrome`.

Pendiente hasta que se decida el cambio, previsiblemente antes de producción.

---

## Bloques cerrados

### Bloque 1 — Superficie de ataque y fronteras de confianza

4 críticas, 6 altas, 4 medios y los bajos. Todo desplegado y verificado con peticiones reales contra producción.

- **C01** SSRF con `DELETE` arbitrario y sin autenticar en `whip-proxy`.
- **C02** Webhook de Cloudflare *fail-open*: omitir la cabecera de firma saltaba la autenticación.
- **C03** Cinco backfills `onRequest` sin autenticación que recorrían colecciones enteras con privilegios de administrador.
- **C04** SSRF almacenado vía `liveData.hlsUrl` en el proxy de espectadores.
- **H01** XSS de origen en `proxy-avatar` (copiaba el `content-type` remoto) + cabeceras de seguridad globales.
- **H02** Cualquier cuenta podía detener el egress de otra.
- **H03** Mutación anónima del estado de OBS.
- **H04** Analítica de compras manipulable sin sesión.
- **H05** Render caro (FFmpeg, egress) sin verificar propiedad del contenido.
- **H06** App Check — integrado; **falta la exigencia, ver pendiente 1**.
- **Medios y bajos:** idempotencia de webhooks, rate limit del TTS, CSRF del logout, filtración de errores de proveedores, timeouts de salida, healthcheck.

### Bloque 2 — Identidad, autenticación, sesiones y cuentas

3 críticas, 6 de 7 altas, 4 de 5 medios y los bajos.

- **C01** Las cuentas anónimas (invitados de compra) podían participar socialmente.
- **C02** Acaparamiento ilimitado y permanente de nombres de usuario.
- **C03** "Revocar sesión" no revocaba nada, y se deshacía sola al reabrir la app.
- **H01** Correo, fecha de nacimiento y sexo eran de lectura pública. **Migrados** a `users/{uid}/private/identity`; los 11 perfiles existentes se migraron y se verificó que no quedó ningún campo personal en el documento público.
- **H02** Correo verificado — **excluido a propósito, ver pendiente 3**.
- **H03** El perfil aceptaba correo, proveedor y campos arbitrarios inventados.
- **H04** La edad mínima solo se comprobaba en el cliente.
- **H05** La caché de Firestore en IndexedDB sobrevivía al cierre de sesión.
- **H06** Bloquear una cuenta no revocaba sus tokens.
- **H07** Gestión de moderadores — cerrado salvo el MFA, **ver pendiente 2**.
- **M05** Protección de rutas solo en cliente. **No se puede cerrar** sin un proyecto de sesión de servidor: el middleware corre en Edge, donde `firebase-admin` no funciona. Impacto bajo, las reglas y las funciones vuelven a autorizar.

**Pruebas:** `test/rules/anonymousContainment.rules.test.ts` cubre la contención de anónimos, el acaparamiento de handles, la revocación de sesiones, la falsificación de perfil, el gate de edad, el proveedor de los moderadores, la lectura acotada del supermoderador y las suscripciones vencidas. La suite completa de reglas está en **205 tests**.

### Bloque 3 — Autorización, roles y escalamiento de privilegios

3 críticas, 6 de 8 altas y 4 de 5 medios. Las dos altas restantes son decisiones tuyas, no hallazgos sin arreglar.

- **C01** Una regla comodín al final del archivo (`match /{document=**} { allow read: if isPlatformMod(); }`) **anulaba todas las restricciones de lectura**, porque en Firestore las reglas se combinan con OR. El supermoderador podía leer mensajes privados, datos fiscales y bancarios, wallets, sesiones, KYC y las **claves de transmisión** de cada directo. Ahora el acceso es explícito colección por colección, y de los mensajes privados solo ve **la conversación que alguien denunció** (`underReview`, marcado por `submitReport`).
- **C02** Un miembro baneado o expulsado seguía obteniendo URLs firmadas de las imágenes de comunidades privadas: la función solo comprobaba que su documento de miembro *existiera*, y al sancionar no se borra, se marca.
- **C03** Los documentos de suscripción tampoco se borran al terminar. Como la regla solo hacía `exists()`, quien pagó una vez podía **recrearse la membresía años después** y volver a entrar sin renovar.
- **H01** Desbanear devolvía el acceso completo aunque el ban hubiera cancelado la suscripción. **Decisión de Luis: tiene que volver a pagar.**
- **H02** Las invitaciones a moderador de comunidad no caducaban ni se revalidaban al aceptar: se podía invitar con la comunidad pública, volverla oculta y aceptar después. **Decisión de Luis: caducan a los 30 días**, y al aceptar se revalida visibilidad y estado.
- **H03** El reporte guardaba el "dueño del contenido" **que mandaba quien reporta**, y ese valor es el que usa el moderador al pulsar bloquear. Se podía señalar a un inocente. Ahora lo resuelve el servidor para los 11 tipos de reporte.
- **H04** Un solo rol lo hace todo — **ver pendiente 3**.
- **H05** Las funciones de dinero (capturar cobros, resolver devoluciones, healthchecks con secretos) exigían el claim pero **no la sesión de Google**. Unificado en `backend/src/authz.ts`.
- **H06** Dos backfills se autorizaban con un correo escrito en el código, sin claim ni proveedor. Incluida la migración de PII del Bloque 2, que se había escrito con ese mismo patrón.
- **H07** El vencimiento de suscripciones depende de una tarea diaria, así que hay hasta 24 h de margen. **Decisión de Luis: se acepta.**
- **H08** Las imágenes de mensajes privados se firmaban validando solo el prefijo de la ruta, así que **se podían renovar después de borrar el mensaje**.
- **M01/M02** La moderación de comunidades no dejaba historial: la huella vivía en el documento de miembro y cada acción sobrescribía la anterior. Nueva colección `groupModerationLog`, inmutable, legible por el dueño de la comunidad y el supermoderador. Importa porque banear cancela suscripciones de Stripe.
- **M03** Un moderador silenciado era rechazado por las reglas pero aceptado por las callables.
- **M04** `getMuxPlaybackToken` solo reconocía `role === "moderator"`, pero las promociones escriben `roleInGroup: "mod"`: se negaba el acceso a moderadores legítimos.
- **M05** Cualquier moderador podía resolver un reporte que otro estaba atendiendo. Ahora se toma en transacción al resolver.

---

## Trabajo relacionado del mismo tramo

- **Node.js 20 → 22** en las 165 Cloud Functions. Node 20 se decomisaba el 2026-10-30. Revisar de nuevo hacia 2027.
- **Cuatro funciones fantasma retiradas** de producción: `diditWebhook` (HTTP público), `createKycSession`, `createStripeCheckoutSession` y `migrateCurrencyMxnToUsd`. Vivían desplegadas sin código en el repositorio, así que ninguna auditoría de código las vio. **Borrar el código no borra la función desplegada.**
- **Política de contraseñas** en Firebase Auth (10 caracteres, mayúscula, minúscula, número y símbolo) en modo *Exigir*. `lib/auth/passwordPolicy.ts` es su espejo exacto: si se cambia una, hay que cambiar la otra.
- **Protección de enumeración de correo** activada en Firebase Auth.
