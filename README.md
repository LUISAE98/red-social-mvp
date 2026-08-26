# Vibra

Plataforma social centrada en creadores: perfiles, comunidades, contenido, video, live streaming, servicios, wallet y monetización directa entre creador y audiencia.

> Vibra prioriza la conexión directa creador–audiencia y las finanzas transparentes. No busca replicar Facebook, Instagram o TikTok.

---

## Pilares del producto

- **Perfiles** — construir audiencia, publicar, monetizar y crear reputación.
- **Comunidades** — espacios privados, membresías y contenido exclusivo.
- **Contenido y Video** — publicaciones, imágenes y video premium (Mux).
- **Live Streaming** — transmisiones en vivo (LiveKit / RTMP / OBS).
- **Servicios** — saludos, meet & greet, sesiones exclusivas.
- **Wallet y Monetización** — saldos, ledger, comisiones, pagos y retiros.
- **KYC** — verificación de identidad y cumplimiento (a través de la procesadora de pagos).

---

## Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Framework | Next.js 16 (App Router, Turbopack) · React 19 |
| Lenguaje | TypeScript (modo estricto) |
| Estilos | Tailwind CSS 4 |
| Backend | Firebase Cloud Functions (Node 20) |
| Datos / Auth / Storage | Firebase (Firestore, Auth, Storage) |
| Video on-demand | Mux |
| Live streaming | LiveKit (+ egress a S3) |
| Monitoreo de errores | Sentry |
| Animación / Media | Framer Motion · hls.js |

---

## Requisitos previos

- **Node.js 20** (el backend fija esta versión en `engines`).
- **npm**.
- **Firebase CLI** para desplegar reglas, índices y funciones:
  ```bash
  npm install -g firebase-tools
  ```

---

## Puesta en marcha

1. **Instalar dependencias**
   ```bash
   npm install
   cd backend && npm install && cd ..
   ```

2. **Configurar variables de entorno**

   Copia la plantilla y rellena tus valores (nunca subas los reales a git):
   ```bash
   cp .env.example .env.local
   ```
   Ver la sección [Variables de entorno](#variables-de-entorno) más abajo.

3. **Arrancar el entorno de desarrollo**
   ```bash
   npm run dev
   ```
   La app queda disponible en `http://localhost:3000`.

---

## Scripts

### Frontend (raíz del proyecto)

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Build de producción. |
| `npm run start` | Sirve el build de producción. |
| `npm run lint` | Linter (ESLint). |

### Backend (`backend/`)

| Comando | Descripción |
|---------|-------------|
| `npm run build` | Compila las Cloud Functions (TypeScript → JS). |
| `npm run serve` | Emuladores de Firebase con las funciones. |
| `npm run deploy` | Despliega las funciones. |
| `npm run logs` | Logs de las funciones. |

---

## Estructura del proyecto

```
app/              Rutas y UI (Next.js App Router)
lib/              Servicios, hooks y utilidades del frontend
types/            Tipos TypeScript compartidos
components/       Componentes reutilizables
backend/src/      Cloud Functions (fuente oficial, ver firebase.json)
firestore.rules   Reglas de seguridad de Firestore
storage.rules     Reglas de seguridad de Storage
firestore.indexes.json  Índices de Firestore
```

> El **único** origen de Cloud Functions es `backend/`. No crear una segunda estructura de funciones.

---

## Variables de entorno

Definir en `.env.local` (frontend) y en la configuración del backend según corresponda. Las variables `NEXT_PUBLIC_*` se exponen al navegador; el resto son secretas y **solo** de servidor.

**Firebase (cliente):**
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

**Firebase Admin (servidor):**
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

**Mux (video):**
- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`

**LiveKit (live streaming):**
- `LIVEKIT_URL` · `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`
- `LIVEKIT_EGRESS_S3_BUCKET` · `LIVEKIT_EGRESS_S3_ENDPOINT` · `LIVEKIT_EGRESS_S3_REGION`

> Los `.env*` están ignorados por git. No comitear secretos.

---

## Despliegue

Las reglas, índices y funciones se despliegan con Firebase CLI:

```bash
firebase deploy --only firestore:rules      # Reglas de Firestore
firebase deploy --only storage              # Reglas de Storage
firebase deploy --only firestore:indexes    # Índices
firebase deploy --only functions            # Cloud Functions
```

---

## Áreas sensibles

Tratar como infraestructura crítica y modificar con especial cuidado:

- **Wallet** (saldos, ledger, comisiones, pagos, retiros)
- **Mercado Pago**
- ~~Didit (KYC)~~ — eliminado el 2026-08-13; el KYC pasa por Stripe
- **Autenticación principal**
- **Reglas de Firestore y Storage**

---

## Convenciones

- TypeScript estricto; evitar `any` innecesarios.
- Reutilizar hooks, servicios y componentes existentes antes de crear nuevos.
- Nunca debilitar reglas de seguridad ni asumir que una validación de frontend es suficiente.
- Los archivos muy grandes se dividen extrayendo `*.utils.ts` (funciones puras) y `*.components.tsx` (subcomponentes), preservando la API pública del módulo.

Ver [`CLAUDE.md`](./CLAUDE.md) para las instrucciones completas de arquitectura y flujo de trabajo.
