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
| 3 | **Aviso de Privacidad Integral** | ⬜ | 🌐 | Pie del rail izquierdo + enlace en `/register` y `/complete-profile` | `03-aviso-privacidad-integral.md` |
| 4 | **Aviso de Privacidad Simplificado (corto)** | ⬜ | 🌐 | Pegado al formulario de `/register` y `/complete-profile` | `04-aviso-privacidad-corto.md` |
| 5 | **Política de Cookies** (+ banner) | ⬜ | 🌐 | Banner 1ª visita (layout raíz) + página en pie del rail izquierdo | `05-politica-cookies.md` |
| 6 | **Normas de Comunidad / Contenido Aceptable** | ⬜ | 🌐 | Pie del rail izquierdo + al publicar (composers) + flujo de reporte | `06-normas-comunidad.md` |
| 7 | **Política de Reembolsos y Cancelaciones** | ⬜ | ❤️ | En cada checkout (`ServicePaymentModal`, overlays de saludo/sesión) + pie del rail | `07-politica-reembolsos.md` |
| 8 | **Términos de la Wallet / Monedero** | ⬜ | 🌐 | Onboarding de wallet (`WalletOnboarding`) | `08-terminos-wallet.md` |
| 9 | **Política de Pagos, Comisiones y Retiros** | ⬜ | ⭐ | Flujo de retiro en `/wallet` + referida desde el Acuerdo de Creador (#2) | `09-pagos-comisiones-retiros.md` |
| 10 | **Consentimiento de Grabación de sesiones 1-a-1** | ⬜ | 🤝 | Modal bloqueante antes de entrar a la videollamada (`LiveKitVideoRoom`) | `10-consentimiento-grabacion.md` |
| 11 | **Aviso y Consentimiento de Datos Biométricos** | ⬜ | ⭐🤝 | Flujo de KYC (Didit, hoy en el retiro) + dentro del #10 | `11-consentimiento-biometrico.md` |
| 12 | **Política de Propiedad Intelectual / DMCA** | ⬜ | 🌐 | Pie del rail izquierdo + al subir contenido + formulario de reporte | `12-propiedad-intelectual-dmca.md` |
| 13 | **Política de Verificación de Edad / Menores** | ⬜ | 🌐 | Gate de edad en `/register` + cláusula en el T&C (#1) | `13-verificacion-edad.md` |

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

## Bitácora de avance

| Fecha | Documento | Cambio |
|-------|-----------|--------|
| 2026-07-24 | — | Creado el índice maestro. Footer legal decidido: pie del rail izquierdo (`OwnerSidebar`). Todos los documentos en estado ⬜ Pendiente. |
| 2026-07-25 | #1 T&C | Borrador v0.1 generado (🟨). Incluye §14 Moderación/Superadmin basada en el sistema real (`moderation.ts`: rol `moderator`, acciones warn/remove/block/report, bitácora `adminAuditLog`) + facultades mutear/banear/eliminar/avisar autoridades. Estructura comparada con YouTube/Patreon. Pendiente: datos de entidad y revisión de abogado. |
| 2026-07-25 | #1 T&C | Ampliado a **v0.2** (83 secciones en 13 partes). Añade: reglas detalladas por tipo de Servicio (Parte VII), pagos/contracargos/AML/sanciones (Parte VI), moderación ampliada con DSA/apelación/preservación (Parte VIII), DMCA + art. 17 UE + reincidentes (Parte IX), servicios de terceros, fuerza mayor, comunicaciones electrónicas, y disposiciones legales completas. Anexo B lista decisiones pendientes. |
