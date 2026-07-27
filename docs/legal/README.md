# Documentos Legales de Vibra — Índice maestro y tracker de construcción

> **Estado:** planeación (2026-07-24). **Ningún documento aquí es asesoría legal.**
> Cada borrador que generemos debe ser **validado y firmado por un abogado mexicano**
> especializado en datos / fintech / consumidor antes de publicarse. Ver [marco-legal.md](../marco-legal.md)
> para el análisis regulatorio de fondo (qué ley exige cada cosa y por qué).

Este archivo es el **panel de control**: lista los 18 documentos legales de Vibra, su estado,
a quién van dirigidos, dónde viven en la app y qué archivo los contendrá. Se actualiza cada vez
que avanzamos uno.

---

## Cómo se construyen (proceso)

1. **Orden por dependencia:** primero los documentos "raíz" que todos los demás referencian
   (Términos y Privacidad), luego los que cuelgan de ellos, y al final los consentimientos
   incrustados en flujos específicos.
2. **Flujo por documento:** `Claude redacta borrador → Luis revisa → Abogado valida/firma → Se publica`.
3. **Uso de plataformas de referencia (Patreon, YouTube, Facebook, OnlyFans, Twitch):**
   se usan **solo como esqueleto/checklist de cláusulas**, NUNCA copiando su texto (su texto tiene
   copyright y está escrito para otra entidad y jurisdicción). El **núcleo mexicano** (Aviso de
   Privacidad LFPDPPP 2025, framing de Wallet/Fintech, reembolsos PROFECO, régimen fiscal SAT) se
   redacta desde cero con base local — esas plataformas no sirven de referencia ahí.
4. Cada documento se guarda como su propio archivo en `docs/legal/` (ver columna "Archivo").

### Leyenda de estado
⬜ Pendiente · 🟨 Borrador (Claude) · 🟦 En revisión (Luis) · 🟩 Validado por abogado · ✅ Publicado en la app

### Leyenda de audiencia
🌐 Todos (visitantes + usuarios) · ❤️ Fans / compradores · ⭐ Creadores · 🤝 Ambas partes de la videollamada

---

## A. Los 13 documentos DEFINITIVOS (bloqueantes para lanzar)

| # | Documento | Estado | Audiencia | Dónde vive en la app | Archivo |
|---|-----------|:------:|:---------:|----------------------|---------|
| 1 | **Términos y Condiciones de Servicio** | 🟨 | 🌐 | Pie del **rail izquierdo** (`OwnerSidebar`) + checkbox en `/register` | [`01-terminos-y-condiciones.md`](./01-terminos-y-condiciones.md) |
| 2 | **Acuerdo de Creador / Monetización** | ⬜ | ⭐ | Al activar monetización (`ProfileServicesTab`) + antes del 1er retiro | `02-acuerdo-de-creador.md` |
| 3 | **Aviso de Privacidad Integral** | 🟨 | 🌐 | Pie del rail izquierdo + enlace en `/register` y `/complete-profile` | [`03-aviso-privacidad-integral.md`](./03-aviso-privacidad-integral.md) |
| 4 | **Aviso de Privacidad Simplificado (corto)** | 🟨 | 🌐 | Pegado al formulario de `/register` y `/complete-profile` | [`04-aviso-privacidad-corto.md`](./04-aviso-privacidad-corto.md) |
| 5 | **Política de Cookies** (+ banner) | 🟨 | 🌐 | Banner 1ª visita (layout raíz) + página en pie del rail izquierdo | [`05-politica-cookies.md`](./05-politica-cookies.md) |
| 6 | **Normas de Comunidad / Contenido Aceptable** | 🟨 | 🌐 | Pie del rail izquierdo + al publicar (composers) + flujo de reporte | [`06-normas-comunidad.md`](./06-normas-comunidad.md) |
| 7 | **Política de Reembolsos y Cancelaciones** | 🟨 | ❤️ | En cada checkout (`ServicePaymentModal`, overlays de saludo/sesión) + pie del rail | [`07-politica-reembolsos.md`](./07-politica-reembolsos.md) |
| 8 | **Términos de la Wallet / Monedero** | ⬜ | 🌐 | Onboarding de wallet (`WalletOnboarding`) | `08-terminos-wallet.md` |
| 9 | **Política de Pagos, Comisiones y Retiros** | ⬜ | ⭐ | Flujo de retiro en `/wallet` + referida desde el Acuerdo de Creador (#2) | `09-pagos-comisiones-retiros.md` |
| 10 | **Consentimiento de Grabación de sesiones 1-a-1** | ⬜ | 🤝 | Modal bloqueante antes de entrar a la videollamada (`LiveKitVideoRoom`) | `10-consentimiento-grabacion.md` |
| 11 | **Aviso y Consentimiento de Datos Biométricos** | ⬜ | ⭐🤝 | Flujo de KYC (Didit, hoy en el retiro) + dentro del #10 | `11-consentimiento-biometrico.md` |
| 12 | **Política de Propiedad Intelectual / DMCA** | ⬜ | 🌐 | Pie del rail izquierdo + al subir contenido + formulario de reporte | `12-propiedad-intelectual-dmca.md` |
| 13 | **Política de Verificación de Edad / Menores** | 🟨 | 🌐 | Gate de edad en `/register` + cláusula en el T&C (#1) | [`13-verificacion-edad.md`](./13-verificacion-edad.md) |

## B. Fase 2 / al escalar (documentos 14–17)

| # | Documento | Estado | Audiencia | Dónde vive | Archivo |
|---|-----------|:------:|:---------:|-----------|---------|
| 14 | **Política de Retención y Eliminación de Datos** | ⬜ | 🌐 (interna + citada en #3) | Interna + resumen en Aviso de Privacidad | `14-retencion-datos.md` |
| 15 | **Procedimiento de Notificación de Brechas** | ⬜ | interna | Documento operativo interno | `15-notificacion-brechas.md` |
| 16 | **Puntos de Contacto + Reporte de Transparencia (DSA)** | ⬜ | 🌐 (UE) | Pie del rail izquierdo (tráfico UE) | `16-dsa-transparencia.md` |
| 17 | **Política de Accesibilidad** | ⬜ | 🌐 | Pie del rail izquierdo | `17-accesibilidad.md` |

## C. Condicional (documento 18)

| # | Documento | Estado | Audiencia | Dónde vive | Archivo |
|---|-----------|:------:|:---------:|-----------|---------|
| 18 | **Política de Contenido Adulto + 2257 + consentimiento de performers** | ⬜ (depende de decisión) | ⭐ | Onboarding de creador adulto + gate de acceso al contenido | `18-contenido-adulto.md` |

> El #18 **solo se construye si Vibra decide permitir contenido para adultos**. Esa decisión sigue pendiente.

---

## Orden de construcción recomendado

Agrupado por dependencia (no por número). Construimos de arriba hacia abajo.

**Bloque 1 — Raíz (todo lo demás los referencia):**
- #1 Términos y Condiciones
- #3 Aviso de Privacidad Integral + #4 corto

**Bloque 2 — Cuelgan de la raíz (público general):**
- #5 Cookies · #6 Normas de Comunidad · #7 Reembolsos · #13 Verificación de Edad

**Bloque 3 — Creador y dinero:**
- #2 Acuerdo de Creador · #8 Términos de Wallet · #9 Pagos/Comisiones/Retiros

**Bloque 4 — Consentimientos incrustados en flujo (los más sensibles):**
- #10 Consentimiento de Grabación · #11 Consentimiento Biométrico · #12 DMCA

**Bloque 5 — Fase 2:** #14–#17 · **Condicional:** #18

---

## Mapa de plataformas de referencia (solo como esqueleto de cláusulas)

| Documento(s) | Referencia útil | Ojo: qué NO copiar |
|--------------|-----------------|--------------------|
| #1 T&C, #6 Comunidad, #12 DMCA | YouTube, Facebook/Meta, Twitch (grandes plataformas UGC, EEUU) | Su jurisdicción y su entidad; su cláusula de arbitraje US |
| #2 Creador, #9 Pagos/Retiros, membresías y propinas | Patreon, Twitch, YouTube | Sus % de comisión y su modelo fiscal (no es SAT) |
| #10 Grabación 1-a-1, saludos | Cameo (saludos); poco precedente para 1-a-1 grabado | — |
| #18 Contenido adulto, 2257, performers | OnlyFans, Fansly | Su marco UK/US; adaptar a reglas de tu procesador |
| #3/#4 Privacidad, #7 Reembolsos, #8 Wallet | **Referencia mexicana**, no las de arriba (Mercado Libre, Clip, fintechs MX) | Redacción propia obligatoria: LFPDPPP 2025 / Fintech / PROFECO |

---

## Brechas legal ↔ código (funciones por implementar)

> Discrepancias detectadas entre lo que los documentos legales prometen y lo que el código hace hoy.
> Cada una es una **función pendiente de construir** para que la Plataforma cumpla lo que el usuario
> firma. Se actualiza conforme redactamos documentos y revisamos el código. Estado: 🔴 pendiente ·
> 🟡 en progreso · 🟢 hecho.

| # | Brecha | Estado | Documento que lo exige | Nota técnica |
|---|--------|:------:|------------------------|--------------|
| G1 | **Falta acción "mutear" (silenciar) cuenta** | 🔴 | T&C §64(b) | `backend/src/moderation.ts` solo implementa `warn_user`, `remove_content`, `block_user`, `report_to_authorities`. Falta agregar `mute_user` (silenciado temporal que limita publicar/interactuar) al enum `VALID_ACTIONS` y su handler. |
| G2 | **Falta acción "eliminar cuenta" por moderación** | 🔴 | T&C §64(f) | Hoy `block_user` deshabilita el login (Firebase Auth `disabled:true` + `platformBanned`), pero no hay borrado/eliminación definitiva de cuenta por moderación. Definir política de borrado vs. baneo y su handler. |
| G3 | **Restringir funciones concretas de una cuenta** | 🔴 | T&C §64(d) | El T&C contempla restringir monetización/transmisión/comentarios de forma granular; hoy la moderación es todo-o-nada (baneo). Falta granularidad. |
| G4 | **Registro de aceptación de consentimientos** | 🔴 | T&C §96 (contratación electrónica) | Guardar por usuario: qué documento/versión aceptó y timestamp (T&C, privacidad, grabación, biométrico, compra). Hoy no existe ese registro probatorio. |
| G5 | **Consentimiento bilateral de grabación antes de la videollamada** | 🔴 | T&C §51.2 / doc #10 | Modal bloqueante de consentimiento de ambas partes antes de entrar a `LiveKitVideoRoom`. Verificar si existe; si no, construir. |
| G6 | **Gate de edad (18+) en el registro** | 🔴 | T&C §7 / doc #13 | Captura de fecha de nacimiento / verificación de mayoría de edad en `/register`. Confirmar existencia. |
| G7 | **Mecanismo de apelación de medidas de moderación** | 🔴 | T&C §68 | Canal para que el usuario apele un baneo/eliminación de contenido. No existe flujo de apelación. |
| G8 | **Cancelación de suscripción "tan fácil como suscribirse"** | 🔴 | T&C §49.2 (FTC/UE) | Al liberar suscripciones recurrentes (hoy pendientes), la cancelación debe ser self-service y simétrica. |
| G9 | **Reembolsos generales / flujo de reembolso** | 🔴 | T&C §42, §48–§55 / doc #7 | Por memoria, los reembolsos generales están pendientes. Necesario para cumplir la Política de Reembolsos. |
| G10 | **Ejercicio de derechos ARCO / privacidad (self-service)** | 🔴 | Aviso de Privacidad #3 | Canal para acceso/rectificación/cancelación/oposición y revocación de consentimiento, y su equivalente GDPR/CCPA. |
| G11 | **Banner de consentimiento de cookies (CMP)** | 🔴 | Política de Cookies #5 | Banner en 1ª visita (layout raíz/`RootChrome`) con Aceptar/Rechazar/Configurar; debe **bloquear scripts no esenciales hasta el opt‑in** y guardar evidencia. Requiere elegir/integrar una CMP. Depende de decidir si se usa analítica/marketing. |
| G12 | **Auditoría de cookies** | 🔴 | Política de Cookies #5 | Escanear la app e inventariar cookies reales (nombre, dominio, categoría, finalidad, duración) para llenar la tabla del documento. |

## Bitácora de avance

| Fecha | Documento | Cambio |
|-------|-----------|--------|
| 2026-07-24 | — | Creado el índice maestro. Footer legal decidido: pie del rail izquierdo (`OwnerSidebar`). Todos los documentos en estado ⬜ Pendiente. |
| 2026-07-25 | #1 T&C | Borrador v0.1 generado (🟨). Incluye §14 Moderación/Superadmin basada en el sistema real (`moderation.ts`: rol `moderator`, acciones warn/remove/block/report, bitácora `adminAuditLog`) + facultades mutear/banear/eliminar/avisar autoridades. Estructura comparada con YouTube/Patreon. Pendiente: datos de entidad y revisión de abogado. |
| 2026-07-25 | #1 T&C | Ampliado a **v0.2** (83 secciones en 13 partes). Añade: reglas detalladas por tipo de Servicio (Parte VII), pagos/contracargos/AML/sanciones (Parte VI), moderación ampliada con DSA/apelación/preservación (Parte VIII), DMCA + art. 17 UE + reincidentes (Parte IX), servicios de terceros, fuerza mayor, comunicaciones electrónicas, y disposiciones legales completas. Anexo B lista decisiones pendientes. |
| 2026-07-26 | Tracker | Añadida sección **Brechas legal ↔ código** (G1–G10): funciones por implementar que los documentos ya prometen (mutear, eliminar cuenta, registro de aceptaciones, consentimiento de grabación, gate de edad, apelación, ARCO self-service, etc.). |
| 2026-07-26 | #3 Aviso de Privacidad | Borrador **v0.1** (🟨) conforme a la **LFPDPPP 2025** (contenido Art. 15, distinción finalidades necesarias/voluntarias, cláusula de transferencias Art. 35) + Anexo GDPR (UE) + Anexo CCPA/CPRA (California). Datos reales mapeados (KYC biométrico, grabaciones, geo por celda IP, wallet, fiscal). Distingue remisiones (encargados) vs. transferencias. Pendiente: confirmar autoridad sucesora del INAI y aviso corto #4. |
| 2026-07-26 | #6, #7, #13 | Borradores **v0.1** (🟨) de las tres. **#6 Normas de Comunidad**: 13 categorías de contenido prohibido, alineadas con motivos/acciones de `moderation.ts`, aplican en comunidades privadas/ocultas, apelación + DSA. **#7 Reembolsos**: regla por cada tipo de Servicio, no‑show, desistimiento UE, contracargos. **#13 Verificación de Edad**: 18+, autodeclaración + KYC creadores, COPPA/AADC, tolerancia cero menores. **Bloque 2 completo en borrador.** |
| 2026-07-26 | #5 Cookies | Borrador **v0.1** (🟨). Categorías (necesarias/funcionales/analíticas/marketing), requisitos del banner (opt‑in previo UE, rechazar tan fácil como aceptar), gestión/revocación, GPC. Añadidas brechas **G11** (banner CMP) y **G12** (auditoría de cookies). Pendiente: decidir si hay analítica/marketing + tabla de cookies real. |
| 2026-07-26 | #4 Aviso corto | Borrador **v0.1** (🟨). Tres versiones: para el formulario, ultra‑corta junto al checkbox, y notas de implementación. Deriva del #3; debe ir visible en `/register` y `/complete-profile` (no solo en footer). |
| 2026-07-26 | #1 T&C | Ampliado a **v0.3** (100 secciones). Catálogo real de los **11 Servicios** (verificado en `registrar-compra-geo`: supercomment, live_donation, live_ticket, premium_post, vod_ticket, greeting, advice, exclusive_session, live_session, subscription, profile_donation). Nuevas secciones: independencia del creador/no relación laboral, sin garantía de ingresos, supercomentarios, tickets/donaciones en vivo, tolerancia cero menores (§67), atención/quejas (PROFECO), verificación/insignias/suplantación, tiendas de apps, contratación electrónica, saldos no reclamados, contenido con IA, transferencias internacionales, accesibilidad. Placeholders reducidos al mínimo. |
