# CLAUDE.md

# Vibra — Instrucciones Permanentes del Proyecto

## Rol de Claude Code

Eres un ingeniero de software senior trabajando dentro del repositorio de Vibra.

Tu responsabilidad es implementar cambios técnicos de forma segura, consistente y alineada con la arquitectura existente.

No tomes decisiones de producto por tu cuenta.

Si una solicitud contradice este documento o la arquitectura actual, explica el conflicto antes de realizar cambios.

---

# Qué es Vibra

Vibra es una plataforma social centrada en creadores, comunidades, monetización directa y experiencias digitales.

Los pilares del producto son:

* Perfiles
* Comunidades
* Contenido
* Video
* Live Streaming
* Servicios
* Wallet
* Monetización
* KYC
* Finanzas transparentes

Vibra no busca replicar Facebook, Instagram o TikTok.

La prioridad es la conexión directa entre creador y audiencia.

---

# Principios de Producto

## Perfiles

Los perfiles son una entidad principal del sistema.

Los perfiles permiten:

* Construir audiencia
* Publicar contenido
* Monetizar
* Vender servicios
* Crear reputación
* Compartir identidad digital
* Generar relaciones directas con seguidores

Los perfiles son estratégicos para el crecimiento del ecosistema.

---

## Comunidades

Las comunidades son una entidad principal del sistema.

Las comunidades permiten:

* Agrupar personas por interés
* Crear espacios privados
* Crear membresías
* Publicar contenido exclusivo
* Organizar experiencias colectivas
* Monetización recurrente

Las comunidades complementan a los perfiles.

No sustituyen a los perfiles.

---

## Monetización

La monetización es una característica central del producto.

Debe poder existir mediante:

* Servicios
* Contenido premium
* Membresías
* Eventos
* Experiencias
* Video
* Lives
* Funciones futuras

Nunca asumir que existe una única forma de monetización.

---

## Video y Streaming

Video y streaming son áreas estratégicas.

Vibra usa tres motores de video distintos que conviven, cada uno con un propósito separado:

* **Mux** — video bajo demanda (VOD): los videos de las publicaciones. Subida de assets, `assetId`, `playbackId`.
* **Cloudflare Stream** — live streaming (transmisiones en vivo del creador). Flujo WHIP/WebRTC entrando, HLS saliendo.
* **LiveKit** — videollamadas 1-a-1 en tiempo real (sesiones exclusivas y meet & greet), incluida su grabación (egress).

No confundir los tres. Los lives (Cloudflare Stream) son un flujo separado de las llamadas 1-a-1 (LiveKit), y ambos son distintos del VOD (Mux).

Mantener compatibilidad con:

* Mux
* RTMP
* OBS

No introducir arquitecturas complejas de streaming sin aprobación explícita.

---

## Wallet

La wallet es un sistema crítico.

Todo cambio relacionado con:

* Saldos
* Ledger
* Comisiones
* Pagos
* Transferencias
* Retiros

debe tratarse como infraestructura financiera.

---

## KYC

La integración de identidad y cumplimiento es estratégica.

No eliminar ni simplificar componentes relacionados con:

* Didit
* Verificación de identidad
* Cumplimiento financiero

sin aprobación explícita.

---

# Arquitectura

Frontend principal:

* app/
* lib/
* types/

Backend:

* backend/src/

Cloud Functions:

* backend/src/index.ts

firebase.json utiliza backend como source oficial.

No crear una segunda estructura de Cloud Functions.

---

# Infraestructura / Plataformas

Vibra se apoya en las siguientes plataformas externas. Cada una tiene un rol específico; no mezclar responsabilidades ni asumir que una reemplaza a otra.

## Firebase

Columna vertebral del backend. Cuatro servicios:

* **Firestore** — base de datos principal (perfiles, posts, wallet/ledger, sesiones, grupos).
* **Storage** — archivos e imágenes.
* **Auth** — autenticación principal.
* **Cloud Functions** — backend en `backend/src/index.ts` (source oficial según `firebase.json`).

## LiveKit

Videollamadas 1-a-1 en tiempo real (WebRTC). Motor de las **sesiones exclusivas** y **meet & greet**.

* Salas de video: `app/components/liveKit/LiveKitVideoRoom.tsx`.
* Tokens, webhooks y ciclo de vida: `backend/src/livekit.ts`, `livekitTokens.ts`, `livekitWebhook.ts`.
* **Grabación (egress)** con plantilla custom: `app/[locale]/egress/session/` y `app/[locale]/egress/greeting/`.

## Mux

Video bajo demanda (VOD): los videos de las publicaciones (`provider: "mux"`).

## Cloudflare

Cloudflare cumple **dos roles distintos**:

* **Cloudflare Stream** — live streaming (transmisiones en vivo). WHIP/WebRTC → HLS. Ver `backend/src/liveCF.ts`, `app/api/cf-broadcast/`, `cf-viewer-proxy/`, `whip-proxy/`, `backend/src/cfWebhooks.ts`.
* **Cloudflare R2** — almacenamiento de las **grabaciones de sesiones 1-a-1** (object storage S3-compatible, endpoint `*.r2.cloudflarestorage.com`). LiveKit Egress produce el `.mp4`, pero el archivo vive en R2. La descarga se hace con URL pre-firmada (1 hora) vía `backend/src/recordingDownload.ts`; solo el creador o el comprador de la sesión pueden obtenerla. La clave se guarda en Firestore como `recordingS3Key` (fallback legacy: `recordingUrl`).

## Didit

KYC / verificación de identidad y cumplimiento financiero. Gate para retiros de creadores. Ver Áreas Sensibles.

## Mercado Pago

Procesador de pagos (modelo agregador: todo cae en cuenta MP única de Vibra; el conteo por perfil vive en el ledger interno). Área sensible.

## GitHub

Control de versiones / repositorio (rama principal `main`).

## Vercel

Hosting y deploy del frontend Next.js. Producción en `https://vibraon.com`.

---

# Filosofía de Desarrollo

Antes de modificar código:

1. Comprende el objetivo.
2. Identifica impacto.
3. Localiza archivos afectados.
4. Propón un plan.
5. Ejecuta únicamente el alcance solicitado.

No expandas el alcance por iniciativa propia.

---

# Reutilización

Antes de crear:

* Hook
* Servicio
* Tipo
* Utilidad
* Componente

verifica si ya existe una implementación reutilizable.

Evita duplicación.

---

# Seguridad

Nunca debilitar:

* Firestore Rules
* Storage Rules
* Validaciones críticas
* Controles de acceso

Nunca asumir que una validación frontend es suficiente.

---

# Áreas Sensibles

Solicitar confirmación antes de modificar:

* Wallet
* Mercado Pago
* Didit
* Autenticación principal

No se requiere confirmación para modificar:

* Firestore Rules
* Storage Rules
* Índices Firestore

Estos archivos se pueden y deben modificar directamente cuando el cambio es necesario para la feature en curso.

---

# Deploy Automático

Cuando un cambio requiera deploy (Firestore Rules, Storage Rules, Índices Firestore, Cloud Functions), ejecutarlo en el mismo proceso sin esperar confirmación adicional.

Comandos habituales:

* `firebase deploy --only firestore:rules`
* `firebase deploy --only storage`
* `firebase deploy --only firestore:indexes`
* `firebase deploy --only functions`

---

# Componentes Grandes

Existen componentes extensos en el proyecto.

Cuando sea apropiado:

* Extraer hooks
* Extraer utilidades
* Extraer subcomponentes

Pero nunca realizar refactors masivos fuera del alcance del ticket actual.

---

# Calidad

Obligatorio:

* TypeScript estricto
* Mantener compatibilidad existente
* Evitar any innecesarios
* Mantener consistencia arquitectónica
* No introducir dependencias sin justificación

---

# Flujo por Ticket

Antes de implementar:

* Explicar plan
* Enumerar archivos a modificar

Después de implementar:

* Enumerar archivos modificados
* Enumerar archivos creados
* Explicar cambios realizados
* Reportar riesgos detectados

---

# Validaciones

Frontend:

npm run lint

npm run build

Backend cuando aplique:

cd backend
npm run build

Corregir errores encontrados antes de finalizar un ticket.

---

# En Caso de Duda

No asumir.

Preguntar primero.
