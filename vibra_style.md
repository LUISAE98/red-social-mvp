# Vibra Style Guide

Registro canónico de estilos reutilizables del sistema de diseño de Vibra.
Referencia obligatoria antes de crear cualquier nuevo componente visual.

---

## Primitivos de UI (`components/ui`) — USAR ANTES QUE COPIAR ESTILO

Los estilos de más abajo ahora están encapsulados en primitivos reutilizables.
**Antes de escribir un `<button>`/`<input>`/avatar/modal a mano, usa el primitivo.**
Los especímenes de estilo que siguen quedan como referencia de diseño (y para
casos verdaderamente a la medida), pero la vía por defecto es:

```tsx
import { Button, Input, TextArea, Avatar, Modal } from "@/components/ui";

<Button variant="primary">Crear comunidad</Button>
<Button variant="brand" fullWidth loading={saving}>Guardar</Button>
<Button variant="gradient">Suscribirme</Button>
<Button variant="ghost" size="sm">Cancelar</Button>
<Button variant="danger">Eliminar</Button>

<Input placeholder="Título" invalid={!!error} />
<TextArea placeholder="Escribe aquí..." rows={4} />

<Avatar src={user.avatarUrl} name={user.name} size={44} />
<Avatar name="Ana Torres" size={40} ringColor="var(--brand)" />

// Modal = VibraResponsivePanel (bottom sheet móvil / panel centrado desktop)
<Modal open={open} onClose={close} title="Título">…</Modal>
```

- **Button** — variantes `primary | brand | gradient | secondary | ghost | danger`,
  tamaños `sm | md | lg`, más `fullWidth`, `loading`, `leftIcon`/`rightIcon`.
  Consume los tokens de color (`var(--brand)`, etc.). Hover/active/foco en `.vibra-btn`.
- **Input / TextArea** — estilo de campo canónico; foco visible vía `.vibra-field`.
- **Avatar** — imagen circular con fallback de iniciales determinista + `ringColor`.
- **Modal** — alias de `VibraResponsivePanel`.

Los tokens de color viven en `:root` de `app/globals.css` y se consumen como
`var(--brand)`, `var(--pink)`, `var(--success)`, etc. (ver #6).

---

## Botones

### Estilo botón principal

Botón de acción primaria. Fondo blanco, texto oscuro, sin borde.

**Referencia:** `GroupRecommendationsRail.tsx` — botón "Crear comunidad" en el rail derecho del feed.

#### Especificaciones

| Propiedad      | Valor                |
|----------------|----------------------|
| `background`   | `"#ffffff"`          |
| `color`        | `"#08111d"`          |
| `fontWeight`   | `700`                |
| `fontSize`     | heredado (`inherit`) |
| `fontFamily`   | `inherit`            |
| `borderRadius` | `12`                 |
| `padding`      | `"10px 14px"`        |
| `border`       | `"none"`             |
| `cursor`       | `"pointer"`          |
| `width`        | automático (fit-content) |

#### Código de referencia

```tsx
<button
  type="button"
  style={{
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    background: "#ffffff",
    color: "#08111d",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  }}
>
  Etiqueta
</button>
```

---

## Panel base (modal/overlay)

Referencia canónica para todos los paneles flotantes de Vibra.
**Referencia:** `PostComposerDesktopOverlay.tsx` — panel "Crear publicación".

---

### Backdrop

```tsx
// Capa de fondo sobre toda la pantalla
{
  position: "fixed",
  inset: 0,                          // top/left/right/bottom: 0
  width: "100vw",
  height: "100vh",
  zIndex: 999999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(0,0,0,0.88)",   // backdrop oscuro semitransparente
  fontFamily: "inherit",
}
// Clic fuera del panel → cerrar:
// onMouseDown: si event.target === event.currentTarget → onClose()
```

### Contenedor del panel (`<section>`)

```tsx
{
  width: "min(100%, 540px)",
  maxHeight: "min(88vh, 680px)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 18,
  background: "#0a0a0a",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
  color: "#fff",
  overflow: "hidden",
  animation: open
    ? "vibraComposerDesktopIn 180ms ease-out"
    : "vibraComposerDesktopOut 180ms ease-in forwards",
}
```

### Animaciones de entrada y salida

```css
@keyframes vibraComposerDesktopIn {
  from { opacity: 0; transform: scale(0.94) translateY(10px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);     }
}
@keyframes vibraComposerDesktopOut {
  from { opacity: 1; transform: scale(1)    translateY(0);     }
  to   { opacity: 0; transform: scale(0.94) translateY(10px);  }
}
```

- Duración: `180ms` — entrada `ease-out`, salida `ease-in forwards`
- Desmontar con `setTimeout(180ms)` para que la salida complete antes de unmount

### Header del panel

```tsx
// Grid 3 columnas: [vacío | título centrado | botón cerrar]
{
  height: 56,
  display: "grid",
  gridTemplateColumns: "48px 1fr 48px",
  alignItems: "center",
  padding: "0 12px",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  flexShrink: 0,
}
```

**Título centrado:**
```tsx
<span style={{
  fontSize: 17,
  fontWeight: 500,
  color: "#fff",
  lineHeight: 1.2,
  textAlign: "center",
  letterSpacing: "-0.02em",
}}>
  Título del panel
</span>
```

**Botón cerrar (X puro, sin contenedor):**
```tsx
<button
  type="button"
  onClick={onClose}
  aria-label="Cerrar"
  style={{
    border: "none",
    background: "none",
    color: "#fff",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    justifySelf: "end",
    padding: 4,
  }}
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
</button>
```

### Área de contenido (scroll)

```tsx
{ flex: 1, overflowY: "auto", minHeight: 0 }
// Padding interior: { padding: "18px 20px 8px" }

// Scrollbar:
.vibra-panel-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
.vibra-panel-scroll::-webkit-scrollbar-track { background: transparent; }
.vibra-panel-scroll::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
}
```

### Divisores

```
"1px solid rgba(255,255,255,0.12)"
```
Usados en `borderBottom` del header y `borderTop` del footer.

### Footer del panel

```tsx
{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)" }
```

**Botón de acción principal:**
```tsx
// Activo
{ width: "100%", height: 42, borderRadius: 5, border: "none",
  background: "var(--brand)", color: "rgba(255,255,255,0.98)",
  fontSize: 17, fontWeight: 500, fontFamily: "inherit",
  cursor: "pointer", letterSpacing: "-0.02em",
  display: "grid", placeItems: "center" }

// Deshabilitado
{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.36)",
  cursor: "not-allowed" }
```

### Mensaje de error inline

```tsx
{ marginTop: 14, borderRadius: 13,
  border: "1px solid rgba(255,90,90,0.24)",
  background: "rgba(120,18,18,0.28)",
  color: "#ffdada", padding: "10px 12px",
  fontSize: 13, lineHeight: 1.4 }
```

---

## Panel móvil (bottom sheet)

Referencia canónica para paneles que abren desde abajo en mobile.
**Referencia:** `PostCommentsPanel.tsx` (path mobile) — patrón validado y en producción.

---

### Backdrop

```tsx
{
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  zIndex: 999999,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: 0,
  background: "rgba(0,0,0,0.52)",
  backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
  fontFamily: "inherit",
}
// Clic fuera → cerrar: onMouseDown: si event.target === event.currentTarget → onClose()
```

### Arquitectura de capas

El panel usa **tres capas separadas** para desacoplar la animación de entrada/salida, el rubber band y el área fija inferior:

```
backdrop (fixed, inset 0)
└── panel-outer   ← entry/exit + close drag + background fill
    ├── section-wrapper  ← solo rubber band hacia arriba
    │   └── section      ← header + contenido, overflow hidden, border-radius
    └── composer / footer  ← anclado al fondo, NO sube con rubber band
```

### Panel outer

Auto-height, capado en `calc(100vh - 72px)`. Maneja la animación de entrada/salida y el arrastre hacia abajo para cerrar. Su `background` llena el hueco entre `section` y `composer` cuando hay rubber band.

```tsx
{
  width: "100%",
  maxHeight: "calc(100vh - 72px)",
  display: "flex",
  flexDirection: "column",
  background: "rgba(8,9,11,0.96)",
  // Entrada/salida + cierre con drag:
  transform: open
    ? `translateY(${Math.max(0, panelOffsetY)}px)`
    : "translateY(100%)",
  transition: isPanelDragging
    ? "none"
    : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
  willChange: "transform",
}
```

- Unmount con `setTimeout(260ms)` — la salida completa antes de desmontar
- `body.overflow = "hidden"` mientras está abierto

### Section wrapper (rubber band)

Solo contiene el `transform` de rubber band hacia arriba. No lleva `overflow` ni `height`.

```tsx
{
  transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
  transition: isPanelDragging
    ? "none"
    : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
}
```

### Section (header + contenido)

`maxHeight` calculado para dejar espacio al composer (~68px). El scroll interno de contenido vive aquí.

```tsx
{
  maxHeight: "calc(100vh - 140px)",  // 72px margen + ~68px composer
  borderRadius: "22px 22px 0 0",
  background: "rgba(8,9,11,0.96)",
  boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
  color: "#fff",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
}
```

Área de scroll interior:
```tsx
{
  flex: 1,
  overflowY: "auto",
  minHeight: 0,
  padding: "12px 14px 8px",
}
```

Scrollbar:
```css
.vibra-panel-mobile-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
.vibra-panel-mobile-scroll::-webkit-scrollbar-track { background: transparent; }
.vibra-panel-mobile-scroll::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
}
```

### Swipe to close + rubber band

El `<header>` es la única zona de agarre (los botones hijo no capturan el drag).

```ts
const PANEL_CLOSE_THRESHOLD = 130   // px — offset positivo que dispara el cierre

function applyPanelOffset(raw: number): number {
  if (raw >= 0) return Math.min(window.innerHeight, raw); // cierre: 1:1
  return raw * 0.2;                                       // subir: rubber band 20%
}
```

Flujo:
1. `onPointerDown` en `<header>` → `setPointerCapture`, guarda `clientY` y `panelOffsetY` actuales
2. `onPointerMove` → `setPanelOffsetY(applyPanelOffset(startOffset + deltaY))`
3. `onPointerUp` → si offset ≥ 130: cerrar; si no: `setPanelOffsetY(0)` (snap back)
4. `transition: "none"` durante drag → `"transform 260ms..."` al soltar

Header: `touchAction: "none"`, `userSelect: "none"`, `WebkitUserSelect: "none"`.

### Header del panel

```tsx
// Grid 3 columnas: [vacío | título centrado | botón cerrar]
{
  height: 56,
  display: "grid",
  gridTemplateColumns: "72px 1fr 72px",
  alignItems: "center",
  padding: "0 12px",
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
}
```

JSX completo del header (copiar tal cual al implementar):

```tsx
<header
  onPointerDown={handlePanelPointerDown}
  onPointerMove={handlePanelPointerMove}
  onPointerUp={handlePanelPointerUp}
  onPointerCancel={handlePanelPointerUp}
  style={{
    height: 56,
    display: "grid",
    gridTemplateColumns: "72px 1fr 72px",
    alignItems: "center",
    padding: "0 12px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    flexShrink: 0,
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  }}
>
  {/* Col 1: spacer vacío — equilibra el × para que el título quede centrado */}
  <div aria-hidden="true" />

  {/* Col 2: título centrado */}
  <h3 style={{
    margin: 0,
    textAlign: "center",
    fontSize: 17,
    fontWeight: 500,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
    color: "#fff",
  }}>
    Título del panel
  </h3>

  {/* Col 3: botón cerrar pegado a la derecha */}
  <button
    type="button"
    onClick={onClose}
    style={{
      width: 40, height: 40,
      border: "none",
      background: "transparent",
      color: "rgba(255,255,255,0.86)",
      cursor: "pointer",
      display: "grid",
      placeItems: "center",
      fontSize: 32,
      fontWeight: 300,
      lineHeight: 1,
      justifySelf: "end",
    }}
  >
    ×
  </button>
</header>
```

### Composer / footer anclado

Vive FUERA del `section-wrapper`, como hijo directo de `panel-outer`. No recibe el rubber band.

```tsx
{
  flexShrink: 0,
  borderTop: "1px solid rgba(255,255,255,0.07)",
  padding: "10px 14px 14px",
}
```

---

## Textarea (campo de texto libre)

Estilo canónico para todos los `<textarea>` de Vibra dentro de paneles y overlays.
**Referencias:** `BuyerGreetingRequestOverlay.tsx`, `BuyerSessionRequestOverlay.tsx`, `SessionRequestOverlay.tsx`.

```tsx
<textarea
  placeholder="Escribe aquí..."
  style={{
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.06)",
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 13,
    fontFamily: "inherit",
    lineHeight: 1.5,
    resize: "none",
    outline: "none",
  }}
/>
```

| Propiedad      | Valor                        |
|----------------|------------------------------|
| `background`   | `rgba(255,255,255,0.06)`     |
| `border`       | `none`                       |
| `borderRadius` | `12`                         |
| `padding`      | `"10px 12px"`                |
| `color`        | `"#fff"`                     |
| `fontSize`     | `13`                         |
| `fontFamily`   | `inherit`                    |
| `lineHeight`   | `1.5`                        |
| `resize`       | `"none"`                     |
| `outline`      | `"none"`                     |
| `width`        | `"100%"` + `boxSizing: "border-box"` |

> El color del placeholder lo controla el navegador por defecto. No se sobreescribe con CSS inline.

---

## Skeletons de carga (base canónica)

Base de **estilo y animación para TODOS los skeletons de la plataforma**. Cualquier
skeleton nuevo (comentarios, servicios, wallet, listas, etc.) se construye sobre
esta misma clase base `.vb-skel` y la misma onda `vbSkelWave`. La forma (avatar,
líneas, bloque de media) se adapta al contenido; el **relleno y la animación no cambian**.

**Referencia:** `app/components/PostSkeleton/PostSkeleton.tsx` (skeleton de post) +
`app/components/PostSkeleton/PostReveal.tsx` (revelado con fade-in).

### Relleno base + onda shimmer

Gradiente diagonal sutil que se desplaza en bucle. Mismo color que el skeleton de
historias del home (`rgba(255,255,255,0.05→0.11)`).

```css
.vb-skel {
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0.05) 30%,
    rgba(255, 255, 255, 0.11) 50%,
    rgba(255, 255, 255, 0.05) 70%
  );
  background-size: 300% 100%;
  animation: vbSkelWave 1.6s ease-in-out infinite;
}
@keyframes vbSkelWave {
  0%   { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}
/* Sin animación si el usuario reduce movimiento: relleno plano */
@media (prefers-reduced-motion: reduce) {
  .vb-skel {
    animation: none;
    background: rgba(255, 255, 255, 0.07);
  }
}
```

| Propiedad          | Valor                                            |
|--------------------|--------------------------------------------------|
| color base         | `rgba(255,255,255,0.05)` → `0.11` → `0.05`       |
| `background-size`  | `300% 100%`                                       |
| animación          | `vbSkelWave 1.6s ease-in-out infinite`           |
| dirección onda     | `180% 0` → `-80% 0` (izq→der, diagonal `100deg`) |
| reduced-motion     | sin animación, relleno plano `0.07`              |
| `border-radius`    | por forma: círculos `50%`, líneas `6`, media `16`|

Se combina con una clase de forma: `<div className="vb-skel vb-skel-avatar" />`,
`vb-skel-line`, `vb-skel-media`, etc. Cada skeleton nuevo define sus formas pero
reutiliza `.vb-skel` tal cual (mismo relleno + `vbSkelWave`). Scoped con styled-jsx.

### Revelado del contenido real (fade-in)

Cuando el contenido real llega, **no aparece de golpe**: se envuelve en un revelador
que mantiene `opacity: 0` hasta que sus imágenes (avatar + media) asientan (load o
error), y entonces hace fade-in. Fallback de seguridad por si alguna imagen es lazy
o se cuelga.

```tsx
{ opacity: ready ? 1 : 0, transition: "opacity 380ms ease", willChange: "opacity" }
// ready = true cuando todos los <img> internos dispararon load/error
// (img.complete cuenta como asentado); fallback ~4s.
```

Patrón por feed: mostrar `<Skeleton />` mientras carga (sin spinner ni texto de
"Cargando…"), y envolver cada ítem real en el revelador. Ver `PostReveal` como
implementación genérica reutilizable (inspecciona los `<img>` que contiene).

---

## Animación

Regla única (aplica a código nuevo y de forma oportunista al que se toque):

* **Por defecto: CSS** (transitions / `@keyframes`) usando los **tokens** de tiempo, nunca ms mágicos:
  * Duraciones: `var(--duration-instant)` 80ms · `var(--duration-fast)` 150ms · `var(--duration-normal)` 250ms · `var(--duration-slow)` 400ms.
  * Easings: `var(--ease-smooth)` · `var(--ease-spring)` · `var(--ease-out)` · `var(--ease-in)`.
  * Viven en `:root` de `app/globals.css`, así que resuelven en CSS y en estilos inline (`transition: "opacity var(--duration-fast) var(--ease-smooth)"`).
* **`framer-motion` SOLO cuando CSS no alcanza**: animaciones de **salida** (montar/desmontar vía `AnimatePresence`) y animaciones de **layout** (`layout`/`layoutId`). Para entradas simples (fade/slide) usa CSS + tokens, no `motion`.
* No introducir nuevas duraciones hardcodeadas (`180ms`, `260ms`, …). Si una existente se toca, acércala al token más próximo.
* El patrón de montar/desmontar con salida en CSS puro ya está resuelto en `VibraResponsivePanel` (estado `isClosing` + `setTimeout`); reúsalo como referencia.
