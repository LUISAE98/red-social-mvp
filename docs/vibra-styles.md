# Vibra — Estilos de referencia

Este archivo documenta los patrones visuales canónicos del sistema de diseño de Vibra.
Antes de crear un panel, modal o header, replica estos estilos exactos.

---

## Panel modal / overlay (estilo "Crear publicación")

Fuente: `PostComposerDesktopOverlay.tsx`

### Panel container
```tsx
{
  background: "rgba(8,9,11,0.985)",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  // Animación de entrada/salida (ver abajo)
  animation: open
    ? "vibraModalIn 180ms ease-out"
    : "vibraModalOut 180ms ease-in forwards",
}
```

### Backdrop
```tsx
{
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
}
// Clickable → cierra el panel con animación de salida
```

### Keyframes de animación
```css
@keyframes vibraModalIn {
  from { opacity: 0; transform: scale(0.94) translateY(10px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);    }
}
@keyframes vibraModalOut {
  from { opacity: 1; transform: scale(1)    translateY(0);    }
  to   { opacity: 0; transform: scale(0.94) translateY(10px); }
}
```
Duración: **180ms ease-out** entrada, **180ms ease-in** salida con `forwards`.

### Header del panel
```tsx
<header style={{
  height: 56,
  display: "grid",
  gridTemplateColumns: "48px 1fr 48px",
  alignItems: "center",
  padding: "0 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
}}>
  <div /> {/* spacer izquierdo */}

  <h2 style={{
    margin: 0,
    textAlign: "center",
    fontSize: 17,
    fontWeight: 500,
    letterSpacing: "-0.02em",
    color: "#fff",
  }}>
    Título del panel
  </h2>

  <button
    type="button"
    onClick={handleClose}
    aria-label="Cerrar"
    style={{
      width: 40,
      height: 40,
      border: "none",
      background: "transparent",
      color: "rgba(255,255,255,0.86)",
      cursor: "pointer",
      display: "grid",
      placeItems: "center",
      fontSize: 32,
      fontWeight: 300,
      lineHeight: 1,
      WebkitTapHighlightColor: "transparent",
    }}
  >
    ×
  </button>
</header>
```

### Cierre animado (patrón)
```tsx
const [closing, setClosing] = useState(false);

const handleClose = () => {
  if (closing) return;
  setClosing(true);
  setTimeout(() => onClose(), 180); // espera a que termine la animación
};
```

---

## Paneles desplegables inline

Patrón para secciones que se **expanden hacia abajo** dentro de la misma página, sin backdrop ni modal.

```tsx
<div
  style={{
    maxHeight: isOpen ? "600px" : "0",
    overflow: "hidden",
    opacity: isOpen ? 1 : 0,
    transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
  }}
>
  {/* contenido del panel */}
</div>
```

- `maxHeight` abierto: valor generoso que supere la altura real del contenido (`600px` para sub-menús compactos, `1200px` para paneles más largos)
- `maxHeight: "0"` cerrado — el contenido colapsa limpiamente
- `overflow: "hidden"` — indispensable para que el colapso funcione
- `opacity` transiciona independiente y más rápido (220ms) para suavizar el fade

### Cuándo usar cada patrón

| Situación | Patrón |
|---|---|
| Modal / overlay con backdrop | Scale + opacity (`vibraModalIn/Out`) |
| Sección que se expande en página | max-height + opacity (este patrón) |

---

## Panel deslizable móvil (bottom sheet)

Fuente: `PostFlamesPanel.tsx`

Panel que sube desde la parte inferior de la pantalla. El usuario puede arrastrarlo hacia abajo para cerrarlo. Si lo arrastra hacia arriba, vuelve elásticamente a su posición.

### Estructura del panel
```tsx
<>
  {/* Piso — tapa la brecha entre el panel y el borde de pantalla al arrastrar hacia arriba */}
  <div
    aria-hidden
    style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: 120,
      background: "rgba(8,9,11,0.96)",
      zIndex: 2147483640,        // mismo z que el backdrop → aparece encima por orden en DOM
      pointerEvents: "none",
      transform: `translateY(${Math.max(0, panelOffsetY)}px)`,
      transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
    }}
  />

  {/* Panel principal */}
  <div style={{
    position: "fixed", bottom: 0, left: 0, right: 0,
    zIndex: 2147483641,          // z+1 sobre el piso
    maxHeight: "calc(100dvh - 72px)",
    borderRadius: "22px 22px 0 0",
    background: "rgba(8,9,11,0.96)",
    boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
    color: "#fff", overflow: "hidden",
    display: "flex", flexDirection: "column",
    transform: `translateY(${panelOffsetY}px)`,
    transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
    willChange: "transform",
  }}>
    {/* Zona de drag: pill + header */}
    {/* ... */}
    {/* Cuerpo scrollable */}
  </div>
</>
```

### Pill de arrastre
```tsx
<div style={{ padding: "12px 0 4px", cursor: "grab" }}>
  <div style={{
    width: 38, height: 4,
    borderRadius: 2,
    background: "rgba(255,255,255,0.18)",
    margin: "0 auto",
  }} />
</div>
```

### Lógica de drag (resistencia elástica al subir)
```tsx
const DRAG_CLOSE_THRESHOLD = 130; // px hacia abajo para cerrar

function handlePointerMove(e: React.PointerEvent) {
  if (!isDragging) return;
  const delta = e.clientY - dragStartYRef.current;
  const raw = dragStartOffsetRef.current + delta;
  // Arrastrar hacia arriba: resistencia ÷4
  setPanelOffsetY(raw < 0 ? raw / 4 : raw);
}

function handlePointerUp() {
  if (!isDragging) return;
  setIsDragging(false);
  if (panelOffsetY >= DRAG_CLOSE_THRESHOLD) {
    onClose();
  } else {
    setPanelOffsetY(0); // regresa magnéticamente
  }
}
```

### Técnica del "piso" (gap prevention)
Cuando el panel se arrastra hacia arriba (`panelOffsetY < 0`), el `borderRadius: "22px 22px 0 0"` deja expuesta la brecha entre el fondo del panel y el borde de pantalla.

**Solución:** un `<div>` "piso" con el mismo color de fondo, `height: 120`, pegado al `bottom: 0`, con el mismo `transform` pero usando `Math.max(0, panelOffsetY)` (no baja del borde, pero sí sube con el panel). Su z-index es igual al backdrop pero aparece después en el DOM → queda visualmente encima del backdrop en esa brecha, y el panel (z+1) lo cubre cuando está en posición normal.

### Apertura / cierre animado
```tsx
// Apertura: starts off-screen, then slide in via double-rAF
if (window.matchMedia("(max-width: 639px)").matches) {
  setPanelOffsetY(window.innerHeight);
  openRafRef.current = requestAnimationFrame(() => {
    openRafRef.current = requestAnimationFrame(() => {
      setPanelOffsetY(0);
    });
  });
}

// Cierre: slide down
if (isMobile) setPanelOffsetY(window.innerHeight);
setTimeout(() => setVisible(false), 260);
```

### Sin separadores entre ítems de lista
Las listas dentro del panel (p.ej. usuarios) no llevan `borderBottom` entre ítems. Solo el header lleva separador:
```tsx
borderBottom: "1px solid rgba(255,255,255,0.08)"
```

---

## Tokens de diseño (`globals.css`)

```
--color-brand:     #a855f7
--color-pink:      #f02fae
--color-surface:   #0f0f0f
--color-surface-2: #1a1a1a
--color-surface-3: #252525
--color-border:    rgba(255,255,255,0.08)

--radius-md:  12px
--radius-lg:  16px
--radius-xl:  20px
--radius-2xl: 28px

--shadow-card: 0 2px 16px rgba(0,0,0,0.4)
--shadow-glow: 0 0 20px rgba(168,85,247,0.3)

--duration-fast:   150ms
--duration-normal: 250ms
--duration-slow:   400ms

--ease-smooth: cubic-bezier(0.4,0,0.2,1)
--ease-spring: cubic-bezier(0.34,1.56,0.64,1)
```

---

## Reglas generales

- **Avatares**: siempre `borderRadius: "50%"`, nunca cuadrados ni con radio fijo.
- **Texto principal en headers**: `fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em"`.
- **Botón de cierre (×)**: carácter `×` (no `✕`), `fontSize: 32, fontWeight: 300, background: transparent, border: none`.
- **Paneles no aparecen de la nada**: siempre usar animación scale + opacity de entrada y salida.
- **Backdrop siempre oscuro**: `rgba(0,0,0,0.72)` con animación de opacidad.
