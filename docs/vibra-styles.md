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
