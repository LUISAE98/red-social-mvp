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

Actualmente se utiliza Mux.

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

* SumSub
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
* SumSub
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
