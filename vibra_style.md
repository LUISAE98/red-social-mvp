# Vibra Style Guide

Registro de componentes visuales reutilizables del sistema de diseño de Vibra.

---

## Switch / Toggle

**Referencia:** `ComposerPremiumPanel.tsx` — opciones de visibilidad y monetización.

El switch morado es el estilo estándar de Vibra para toggles de dos estados (activo / inactivo).

### Especificaciones

**Rail (contenedor exterior)**
- `width: 40, height: 22, borderRadius: 11`
- Estado ON: `background: "#a855ff"`, sin borde
- Estado OFF: `background: "transparent"`, `boxShadow: "inset 0 0 0 1.5px rgba(168,85,255,0.3)"`
- `transition: "background 0.18s"`

**Thumb (bolita interior)**
- `width: 16, height: 16, borderRadius: "50%"`, `top: 3`
- Estado ON: `left: 21`, `background: "#fff"`, `boxShadow: "0 1px 3px rgba(0,0,0,0.35)"`
- Estado OFF: `left: 3`, `background: "rgba(196,168,255,0.45)"`, sin sombra
- `transition: "left 0.18s, background 0.18s"`

### Código de referencia

```tsx
{/* Rail */}
<span
  aria-hidden="true"
  style={{
    width: 40,
    height: 22,
    borderRadius: 11,
    background: isOn ? "#a855ff" : "transparent",
    boxShadow: isOn ? "none" : "inset 0 0 0 1.5px rgba(168,85,255,0.3)",
    position: "relative",
    flexShrink: 0,
    display: "inline-block",
    transition: "background 0.18s",
  }}
>
  {/* Thumb */}
  <span
    style={{
      position: "absolute",
      top: 3,
      left: isOn ? 21 : 3,
      width: 16,
      height: 16,
      borderRadius: "50%",
      background: isOn ? "#fff" : "rgba(196,168,255,0.45)",
      boxShadow: isOn ? "0 1px 3px rgba(0,0,0,0.35)" : "none",
      transition: "left 0.18s, background 0.18s",
    }}
  />
</span>
```

---

## Tipografía

### Título de panel / modal / sección
- `fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, letterSpacing: "-0.02em"`
- Centrado, solo primera letra en mayúscula (sentence case)
- Referencia: "Crear publicación" en `PostComposerDesktopOverlay.tsx` y `PostComposerMobileOverlay.tsx`, "Configurar monetización" en `ComposerPremiumPanel.tsx`, `sectionHeader()` en `LiveCreatorPanel.tsx`

### Header de sección
- Mismo estilo que título de panel: `fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, letterSpacing: "-0.02em"`
- Centrado en su columna, con elementos extra posicionados en `position: absolute; right: 16`
- Referencia: `sectionHeader()` en `LiveCreatorPanel.tsx`

---

## Cards flotantes

**Referencia:** `LiveViewerModal.tsx` — desktop portrait y horizontal.

- `borderRadius: 18`
- `background: "#0a0a0a"` (video) / `"#0d0d12"` (paneles)
- `boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)"`
- `overflow: "hidden"`
- Backdrop: `background: "rgba(0,0,0,0.88)"`

---

## Separadores

- `borderBottom: "1px solid rgba(255,255,255,0.12)"`
- Constante `DIV` en `LiveCreatorPanel.tsx`

