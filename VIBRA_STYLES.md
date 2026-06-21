# Vibra — Referencia de Estilos y Animaciones

Archivo de registro. No es código ejecutable.
Aquí viven los estilos base, tokens de diseño y patrones de animación que deben aplicarse consistentemente en toda la app.

---

## Colores base

```
Fondo general de app:        #000000
Fondo de panel / overlay:    rgba(8, 9, 11, 0.96)   ← mobile
                             rgba(8, 9, 11, 0.985)  ← desktop
Borde sutil (panel):         1px solid rgba(255, 255, 255, 0.10)
Borde muy tenue (divisor):   1px solid rgba(255, 255, 255, 0.08)
Texto primario:              #ffffff
Texto secundario:            rgba(255, 255, 255, 0.74)
Texto deshabilitado:         rgba(255, 255, 255, 0.36)
Acento principal (púrpura):  #a855ff
Acento peligro (rojo):       #ef4444  /  #ff8a8a (texto peligro en menús)
Éxito:                       #22c55e
```

---

## Backdrop de overlay

Aplicar siempre que un panel flote sobre el contenido.

```
background:        rgba(0, 0, 0, 0.52)
backdropFilter:    blur(10px)
WebkitBackdropFilter: blur(10px)
position: fixed
inset: 0
zIndex: 999999  (composer)  /  99990 (menús de acción)
```

---

## Panel base — Desktop

**Referencia:** `PostComposerDesktopOverlay.tsx`

```
width:             min(100%, 540px)
maxHeight:         min(88vh, 680px)
borderRadius:      12px  ← todas las esquinas iguales
border:            1px solid rgba(255, 255, 255, 0.10)
background:        rgba(8, 9, 11, 0.985)
boxShadow:         0 30px 90px rgba(0,0,0,0.56),
                   0 0 0 1px rgba(255,255,255,0.035)
color:             #ffffff
overflow:          hidden
```

### Cabecera del panel — Desktop

```
height:            56px
gridTemplateColumns: 48px 1fr 48px
padding:           0 12px
borderBottom:      1px solid rgba(255, 255, 255, 0.08)
```

Título: `fontSize: 17, fontWeight: 500, textAlign: center, letterSpacing: -0.02em`
Botón cerrar (×): derecha, `fontSize: 32, fontWeight: 300, color: rgba(255,255,255,0.86)`

### Animación entrada — Desktop

```css
@keyframes panelDesktopIn {
  from { opacity: 0; transform: scale(0.94) translateY(10px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);    }
}
/* duración: 180ms  easing: ease-out */
```

### Animación salida — Desktop

```css
@keyframes panelDesktopOut {
  from { opacity: 1; transform: scale(1)    translateY(0);    }
  to   { opacity: 0; transform: scale(0.94) translateY(10px); }
}
/* duración: 180ms  easing: ease-in  fill-mode: forwards */
```

---

## Panel mobile — Pestaña estándar ⭐

**Referencia:** `ProfileFollowersOverlay.tsx`
**Usar para:** casi todo — seguidores, menús, detalles, listas, confirmaciones.

El panel crece con su contenido. No deja espacio muerto abajo. Si el contenido supera el máximo, hace scroll internamente.

```
width:         100%
height:        auto            ← crece con el contenido
maxHeight:     calc(100vh - 72px)
borderRadius:  22px 22px 0 0
border:        1px solid transparent
background:    rgba(8, 9, 11, 0.96)
boxShadow:     0 -24px 80px rgba(0, 0, 0, 0.56)
color:         #ffffff
overflow:      hidden
display:       flex
flexDirection: column
position:      fixed, bottom 0, left 0, right 0 (vía portal en document.body)
```

### Scroll lock

Mientras el panel está montado (`shouldRender = true`), bloquear scroll del body:

```
document.body.style.overflow = "hidden"   ← al montar
document.body.style.overflow = prevValue  ← al desmontar
```

### Zona de arrastre — pill + header unificados

El pill visual y el header viven dentro de un mismo `div` con los handlers de arrastre.
Esto permite arrastrar desde cualquier punto del header (incluyendo el área del título).
Los botones dentro del header están protegidos con un guard.

```
<div onPointerDown onPointerMove onPointerUp onPointerCancel
     style={{ touchAction: "none", userSelect: "none" }}>

  // Pill visual (padding: "12px 0 4px", cursor: "grab")
  <div style={{ width: 38, height: 4, borderRadius: 2,
                background: rgba(255,255,255,0.18), margin: "0 auto" }} />

  // Header
  <div style={{ height: 56, gridTemplateColumns: "48px 1fr 48px",
                padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
    <button ×>   |   <h2 título>   |   <div vacío>
  </div>
</div>
```

**Guard de botones en `onPointerDown`:**
```
if ((e.target as HTMLElement).closest("button")) return;
// → el botón recibe su click normal, sin iniciar arrastre
```

### Lógica de arrastre

```
PANEL_CLOSE_THRESHOLD: 130px

onPointerDown:
  capturar pointerId en el div contenedor
  guardar clientY inicial y offset actual

onPointerMove:
  raw = offsetInicial + (clientY - clientYInicial)
  si raw < 0  →  panelOffsetY = raw / 4   ← resistencia hacia arriba
  si raw >= 0 →  panelOffsetY = raw        ← libre hacia abajo

onPointerUp:
  si panelOffsetY >= 130  →  onClose()
  si panelOffsetY < 130   →  panelOffsetY = 0  ← magnetismo a posición inicial
```

La resistencia de 1/4 hacia arriba da la sensación de que el panel "sabe" que ya está en su tope pero permite un pequeño movimiento. Al soltar, la transición spring lo devuelve a 0 automáticamente.

### Animación entrada — Pestaña estándar

```
Estado inicial:  transform: translateY(window.innerHeight)  ← fuera de pantalla
Estado abierto:  transform: translateY(0)

transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1)
willChange: transform
```

Apertura con doble `requestAnimationFrame` para que el navegador pinte primero el estado cerrado.

### Animación salida — Pestaña estándar

```
transform: translateY(window.innerHeight)
transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1)

Portal se desmonta 260ms después de iniciar cierre.
```

Durante arrastre activo: `transition: none` (sin interpolación, sigue el dedo exacto).

### Contenido scrolleable interno

```
// Área de contenido dentro del panel:
flex: 1
minHeight: 0
overflowY: auto
padding: 14px
```

`minHeight: 0` es obligatorio para que el flex child pueda encogerse y activar el scroll cuando el panel llega a su `maxHeight`.

---

## Panel mobile — Variante composer (espacio muerto intencional)

**Referencia:** `PostComposerMobileOverlay.tsx`
**Usar solo para:** el composer de publicación, donde se quiere la pantalla llena siempre.

La diferencia clave es que usa `height` fija en lugar de `auto`, ocupando siempre toda la pantalla disponible independientemente del contenido.

```
height:    calc(100vh - 72px)   ← fija, siempre llena
maxHeight: calc(100vh - 72px)
```

Cabecera del composer usa columnas más anchas para acomodar botones a ambos lados:
```
gridTemplateColumns: 72px 1fr 72px   ← más ancho que el estándar (48px)
borderBottom:        1px solid transparent   ← sin divisor visible
```

El área de arrastre en el composer es solo el header (sin pill separado).
No tiene guard de botones porque el botón de acción va en el lado derecho del header.

---

## Easing estándar

```
Entrada suave:        cubic-bezier(0.22, 1, 0.36, 1)   ← spring-like, overshoot suave
Salida rápida:        ease-in
Transiciones cortas:  140–180ms
Transiciones medias:  220–260ms
Transiciones largas:  300–360ms
```
