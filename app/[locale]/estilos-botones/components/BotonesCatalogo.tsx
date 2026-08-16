"use client";

/**
 * Catálogo de TODOS los botones de Vibra, agrupados por familia.
 *
 * Los datos del encabezado salen de un barrido real del repositorio (327 `.tsx`
 * en `app/` y `components/`), no de memoria. Cada ficha dice DÓNDE vive ese
 * botón y con qué medidas, para poder decidir cuáles se quedan cuando se cierre
 * la escala del sistema de diseño.
 *
 * Los botones se redibujan aquí con sus medidas reales en vez de importarse de
 * su sitio: casi todos viven dentro de componentes que arrastran sesión, datos
 * de Firestore o un panel abierto. Lo que importa es comparar la FORMA.
 *
 * La excepción es el primitivo `Button`, que sí se importa de verdad: es la
 * fuente única y si cambia, este catálogo debe cambiar con él.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui";
import EditTextButton from "@/components/ui/EditTextButton";

/* ─────────────────────────── Datos del inventario ─────────────────────────── */

const INVENTARIO = [
  { label: "Archivos .tsx barridos", value: "327" },
  { label: "<button> escritos a mano", value: "818" },
  { label: "Con estilo inline", value: "294" },
  { label: "Con clase CSS", value: "99" },
  { label: "Con objeto de estilo", value: "36" },
  { label: "Icono suelto, sin estilo propio", value: "389" },
  { label: "Firmas de estilo distintas", value: "130" },
  { label: "Archivos que usan el primitivo", value: "37" },
];

/* ──────────────────────────────── Tipos ──────────────────────────────── */

type Ficha = {
  nombre: string;
  /** Dónde aparece en el producto, en lenguaje de usuario. */
  contexto: string;
  /** Archivo de referencia. */
  archivo: string;
  /** Cuántas veces aparece esa firma en el repo, si se pudo contar. */
  usos?: string;
  /** Medidas que definen la familia. */
  medidas: string;
  render: ReactNode;
  /** Marca las que ya están cubiertas por el primitivo. */
  duplicaPrimitivo?: string;
};

type Familia = {
  id: string;
  titulo: string;
  intro: string;
  fichas: Ficha[];
};

/* ─────────────────── Estilos base que se repiten en el catálogo ─────────────────── */

const baseBtn: CSSProperties = {
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
};

function CerrarSvg({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LupaSvg() {
  return (
    <svg
      aria-hidden="true"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/* ────────────────────────────── El catálogo ────────────────────────────── */

const FAMILIAS: Familia[] = [
  {
    id: "primitivo",
    titulo: "1 · El primitivo",
    intro:
      "La fuente única declarada en vibra_style.md. Seis variantes por tres tamaños. Solo 37 de los 327 archivos lo usan, así que casi todo lo de abajo existe porque este no cubría el caso — o porque no se miró antes de escribir.",
    fichas: [
      {
        nombre: "primary",
        contexto: "Acción principal. Botón «Crear comunidad» del rail derecho del feed.",
        archivo: "components/ui/Button.tsx",
        medidas: "#ffffff · #08111d · peso 700",
        render: <Button variant="primary">Crear comunidad</Button>,
      },
      {
        nombre: "brand",
        contexto: "Sólido de marca. Acción de confirmación dentro de paneles.",
        archivo: "components/ui/Button.tsx",
        medidas: "var(--brand) · blanco 0.98 · peso 600",
        render: <Button variant="brand">Guardar</Button>,
      },
      {
        nombre: "gradient",
        contexto: "Llamada a la acción fuerte. Suscribirse, comprar.",
        archivo: "components/ui/Button.tsx",
        medidas: "rosa → morado → azul 135° · peso 600",
        render: <Button variant="gradient">Suscribirme</Button>,
      },
      {
        nombre: "secondary",
        contexto: "Acción de apoyo sobre superficie translúcida.",
        archivo: "components/ui/Button.tsx",
        medidas: "blanco 0.08 · #fff · peso 600",
        render: <Button variant="secondary">Ver detalles</Button>,
      },
      {
        nombre: "ghost",
        contexto: "Acción terciaria. Cancelar, cerrar, descartar.",
        archivo: "components/ui/Button.tsx",
        medidas: "transparente · blanco 0.86 · peso 600",
        render: <Button variant="ghost">Cancelar</Button>,
      },
      {
        nombre: "danger",
        contexto: "Destructivo. Eliminar publicación, expulsar integrante.",
        archivo: "components/ui/Button.tsx",
        medidas: "var(--error) · #fff · peso 600",
        render: <Button variant="danger">Eliminar</Button>,
      },
      {
        nombre: "Tamaños sm · md · lg",
        contexto: "sm en filas densas, md por defecto, lg en acciones de página completa.",
        archivo: "components/ui/Button.tsx",
        medidas: "radio 10 / 12 / 14 · texto 13 / 14 / 16",
        render: (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button size="sm">sm</Button>
            <Button size="md">md</Button>
            <Button size="lg">lg</Button>
          </div>
        ),
      },
      {
        nombre: "Cargando y deshabilitado",
        contexto: "Envío en curso y acción no disponible.",
        archivo: "components/ui/Button.tsx",
        medidas: "deshabilitado, blanco 0.1 · blanco 0.36",
        render: (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="brand" loading>
              Guardando
            </Button>
            <Button variant="brand" disabled>
              No disponible
            </Button>
          </div>
        ),
      },
      {
        nombre: "Con icono y a todo el ancho",
        contexto: "Acción de pie de panel o de formulario.",
        archivo: "components/ui/Button.tsx",
        medidas: "hueco de 8 entre icono y texto",
        render: (
          <Button variant="gradient" fullWidth leftIcon={<LupaSvg />}>
            Buscar comunidades
          </Button>
        ),
      },
    ],
  },

  {
    id: "accion",
    titulo: "2 · Acción principal escrita a mano",
    intro:
      "Lo mismo que resuelve el primitivo, reescrito. Aquí está la duplicación más cara del repositorio: seis maneras distintas de decir «este es el botón importante».",
    fichas: [
      {
        nombre: "Acción de pie de panel",
        contexto:
          "El botón grande del footer de todos los paneles y overlays. Publicar, enviar, confirmar.",
        archivo: "vibra_style.md · PostComposerDesktopOverlay",
        usos: "7 apariciones de esta firma",
        medidas: "alto 42 · radio 5 · texto 17/500 · var(--brand)",
        duplicaPrimitivo: "Button variant=brand",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              width: "100%",
              height: 42,
              borderRadius: 5,
              background: "#a855f7",
              color: "rgba(255,255,255,0.98)",
              fontSize: 17,
              fontWeight: 500,
              letterSpacing: "-0.02em",
            }}
          >
            Publicar
          </button>
        ),
      },
      {
        nombre: "Acción de pie, deshabilitada",
        contexto: "Mismo botón sin nada que enviar todavía.",
        archivo: "vibra_style.md",
        medidas: "blanco 0.1 · blanco 0.36 · no permitido",
        render: (
          <button
            type="button"
            disabled
            style={{
              ...baseBtn,
              width: "100%",
              height: 42,
              borderRadius: 5,
              background: "rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.36)",
              fontSize: 17,
              fontWeight: 500,
              cursor: "not-allowed",
            }}
          >
            Publicar
          </button>
        ),
      },
      {
        nombre: "Principal blanco",
        contexto: "«Crear comunidad» en el rail de recomendaciones del feed.",
        archivo: "GroupRecommendationsRail.tsx",
        medidas: "radio 12 · relleno 10×14 · #fff · peso 700",
        duplicaPrimitivo: "Button variant=primary",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              borderRadius: 12,
              padding: "10px 14px",
              background: "#ffffff",
              color: "#08111d",
              fontWeight: 700,
            }}
          >
            Crear comunidad
          </button>
        ),
      },
      {
        nombre: "Principal de buscador",
        contexto: "«Unirme» en cada resultado del panel de búsqueda de comunidades.",
        archivo: "GroupsSearchPanel.tsx · .primary-btn",
        usos: "2 clases + variantes",
        medidas: "ancho fijo 134 · alto 34 · radio 10 · texto 12/600",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              width: 134,
              minHeight: 34,
              padding: "7px 8px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #ec4899, #9333ea)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              letterSpacing: "-0.01em",
            }}
          >
            Unirme
          </button>
        ),
      },
      {
        nombre: "Cerrar sesión",
        contexto: "En el menú de ajustes y en el header de escritorio.",
        archivo: "app/LogoutButton.tsx",
        usos: "3 variantes del mismo botón",
        medidas: "alto 40 · radio 10 · morado 0.4 · texto 14/600",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              width: "100%",
              height: 40,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(90, 41, 174, 0.4)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
            }}
          >
            Cerrar sesión
          </button>
        ),
      },
    ],
  },

  {
    id: "marca",
    titulo: "3 · Marca y gradiente",
    intro:
      "Los gradientes de Vibra. Hay tres recetas distintas conviviendo, con ángulos y paradas diferentes — dos colores, tres colores y cuatro colores animados.",
    fichas: [
      {
        nombre: "Entrar (header y celular)",
        contexto:
          "Botón de sesión del header público y su gemelo fijo abajo en perfiles y comunidades sin sesión.",
        archivo: "app/RootChrome.tsx",
        medidas: "4 paradas 100° · fondo 280% · radio 9 · alto 34–42",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              minHeight: 34,
              padding: "0 14px",
              borderRadius: 9,
              backgroundImage:
                "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%, #ff2fb3 100%)",
              backgroundSize: "280% 280%",
              backgroundPosition: "0% 50%",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Entrar
          </button>
        ),
      },
      {
        nombre: "Seguir",
        contexto: "Tarjeta de perfil, panel de seguidores y lista completa de un rail.",
        archivo: "components/profile/FollowStateButton.tsx",
        medidas: "radio 10 · relleno 0×14 · texto 12/600 · rosa → morado 135°",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              minHeight: 30,
              padding: "0 14px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #ec4899, #9333ea)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Seguir
          </button>
        ),
      },
      {
        nombre: "Gradiente inverso pequeño",
        contexto: "Etiquetas de acción dentro de tarjetas de contenido de pago.",
        archivo: "firma inline",
        usos: "2 apariciones",
        medidas: "azul → morado → rosa 135° · radio 6 · texto 11/600",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "5px 10px",
              borderRadius: 6,
              background: "linear-gradient(135deg, #4f46ff, #a855f7, #ff2fb3)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Desbloquear
          </button>
        ),
      },
    ],
  },

  {
    id: "estado",
    titulo: "4 · Estado y pertenencia",
    intro:
      "Botones que informan tanto como actúan. Comparten forma con los de acción pero apagados, porque lo que dicen es «ya está hecho».",
    fichas: [
      {
        nombre: "Siguiendo",
        contexto: "El mismo botón de «Seguir» una vez que ya sigues a ese perfil.",
        archivo: "components/profile/FollowStateButton.tsx",
        medidas: "blanco 0.07 · radio 10 · texto 12/600",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              minHeight: 30,
              padding: "0 14px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.9)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Siguiendo
          </button>
        ),
      },
      {
        nombre: "Ya eres integrante",
        contexto: "Resultado de búsqueda de una comunidad a la que ya perteneces.",
        archivo: "GroupsSearchPanel.tsx · .member-state",
        usos: "4 apariciones",
        medidas: "ancho fijo 134 · blanco 0.06 · blanco 0.5 · texto 12/600",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              width: 134,
              minHeight: 34,
              padding: "7px 8px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.5)",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Integrante
          </button>
        ),
      },
      {
        nombre: "Superficie translúcida",
        contexto: "Acción secundaria dentro de tarjetas y paneles.",
        archivo: "firma inline",
        usos: "4 apariciones",
        medidas: "blanco 0.08 · radio 10 · texto 14/600",
        duplicaPrimitivo: "Button variant=secondary",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "9px 14px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Ver detalles
          </button>
        ),
      },
      {
        nombre: "Translúcido pequeño",
        contexto: "Filtros y acciones menores dentro de listas densas.",
        archivo: "firma inline",
        usos: "3 apariciones",
        medidas: "blanco 0.10 · radio 6 · blanco 0.70 · texto 13/500",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "6px 12px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.70)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Filtrar
          </button>
        ),
      },
    ],
  },

  {
    id: "texto",
    titulo: "5 · Texto y enlace",
    intro:
      "Sin fondo ni borde. Todos son morados, pero cada uno con su tamaño y su peso — 11, 12 y 13, pesos 600 y 700.",
    fichas: [
      {
        nombre: "Editar",
        contexto:
          "Bajo el avatar y sobre la portada, en tu perfil y en tus comunidades. Sustituyó a los lápices flotantes.",
        archivo: "components/ui/EditTextButton.tsx",
        medidas: "#a855f7 · texto 11–13/600 · sombra de texto",
        render: (
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <EditTextButton onClick={() => {}} ariaLabel="Editar avatar">
              Editar
            </EditTextButton>
            <EditTextButton onClick={() => {}} ariaLabel="Editar portada" style={{ fontSize: 12 }}>
              Editar portada
            </EditTextButton>
          </div>
        ),
      },
      {
        nombre: "Ver todas",
        contexto:
          "Encabezado de cada sección del buscador y de los rails del sidebar cuando hay más de lo que cabe.",
        archivo: "GroupsSearchPanel.tsx · .section-more",
        usos: "4 apariciones",
        medidas: "#a855f7 · texto 13/600 · sin fondo",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              background: "none",
              color: "#a855f7",
              fontWeight: 600,
              fontSize: 13,
              padding: "12px 14px 8px",
            }}
          >
            Ver todas
          </button>
        ),
      },
      {
        nombre: "Texto morado compacto",
        contexto: "Acciones dentro de tarjetas de la wallet y de listas de experiencias.",
        archivo: "firma inline",
        usos: "6 apariciones",
        medidas: "transparente · #a855f7 · texto 12/700",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              background: "transparent",
              color: "#a855f7",
              fontSize: 12,
              fontWeight: 700,
              padding: 0,
            }}
          >
            Ver movimiento
          </button>
        ),
      },
      {
        nombre: "Texto apagado",
        contexto: "Acciones de bajo peso, como «omitir» o «más tarde».",
        archivo: "firma inline",
        usos: "5 apariciones",
        medidas: "blanco 0.55 · texto 11/700",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              background: "none",
              color: "rgba(255,255,255,0.55)",
              fontSize: 11,
              fontWeight: 700,
              padding: 0,
            }}
          >
            Omitir
          </button>
        ),
      },
    ],
  },

  {
    id: "iconos",
    titulo: "6 · Iconos",
    intro:
      "389 de los 818 botones son un icono suelto sin estilo propio: heredan del contenedor y no tienen forma común. Estos son los que sí la tienen.",
    fichas: [
      {
        nombre: "Icono redondo de portada",
        contexto: "Lupa y acciones sobre la portada de una comunidad.",
        archivo: "lib/groups/groupPageStyles.ts",
        medidas: "34×34 · círculo · degradado negro · icono morado",
        render: (
          <button
            type="button"
            aria-label="Buscar"
            style={{
              ...baseBtn,
              width: 34,
              height: 34,
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
              color: "rgba(168,85,247,0.98)",
              padding: 0,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 24px rgba(0,0,0,0.5)",
            }}
          >
            <LupaSvg />
          </button>
        ),
      },
      {
        nombre: "Icono redondo translúcido",
        contexto: "Controles dentro del visor de imágenes y del reproductor.",
        archivo: "firma inline",
        usos: "2 apariciones",
        medidas: "blanco 0.10 · círculo · blanco 0.72 · texto 28/300",
        render: (
          <button
            type="button"
            aria-label="Siguiente"
            style={{
              ...baseBtn,
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.72)",
              fontSize: 28,
              fontWeight: 300,
              padding: 0,
            }}
          >
            ›
          </button>
        ),
      },
      {
        nombre: "Subir al inicio",
        contexto:
          "Flotante morado sobre el feed de home, perfil y comunidad. Se mantiene pulsado para volver arriba.",
        archivo: "app/components/ScrollToTopFAB/ScrollToTopFAB.tsx",
        medidas: "46 interior · anillo de progreso 58 · degradado morado 135°",
        render: (
          <div
            style={{
              ...baseBtn,
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #a855f7, #7c3aed)",
            }}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </div>
        ),
      },
      {
        nombre: "Icono de la barra inferior",
        contexto: "Los cinco a siete iconos del nav de celular, con su globo de avisos.",
        archivo: "app/components/MobileBottomNav.tsx",
        medidas: "icono 30 · alto 54 · globo rojo #ff3b30 · pop al tocar",
        render: (
          <div style={{ position: "relative", display: "inline-grid", placeItems: "center", height: 54, width: 54 }}>
            <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8" />
              <path d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span
              style={{
                position: "absolute",
                top: 8,
                insetInlineEnd: 8,
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: 999,
                background: "#ff3b30",
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                lineHeight: "16px",
                textAlign: "center",
                boxShadow: "0 0 0 2px #000",
              }}
            >
              3
            </span>
          </div>
        ),
      },
    ],
  },

  {
    id: "cerrar",
    titulo: "7 · Cerrar",
    intro:
      "El caso con más duplicación silenciosa del repositorio: 28 apariciones repartidas en dos dibujos distintos que hacen exactamente lo mismo.",
    fichas: [
      {
        nombre: "Cerrar, aspa dibujada",
        contexto: "Cabecera de los paneles de escritorio.",
        archivo: "vibra_style.md · panel base",
        usos: "17 apariciones",
        medidas: "sin fondo · #fff · aspa SVG 18 · trazo 2.5",
        render: (
          <button
            type="button"
            aria-label="Cerrar"
            style={{ ...baseBtn, background: "none", color: "#fff", padding: 4 }}
          >
            <CerrarSvg />
          </button>
        ),
      },
      {
        nombre: "Cerrar, aspa tipográfica",
        contexto: "Cabecera de las pestañas inferiores de celular.",
        archivo: "vibra_style.md · panel móvil",
        usos: "11 apariciones",
        medidas: "40×40 · blanco 0.86 · carácter × a 32/300",
        render: (
          <button
            type="button"
            aria-label="Cerrar"
            style={{
              ...baseBtn,
              width: 40,
              height: 40,
              background: "transparent",
              color: "rgba(255,255,255,0.86)",
              fontSize: 32,
              fontWeight: 300,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ),
      },
    ],
  },

  {
    id: "moderacion",
    titulo: "8 · Moderación y destructivo",
    intro:
      "Aceptar y rechazar en avisos, y las acciones que no tienen vuelta atrás. El par aprobar/rechazar comparte forma y solo cambia de color.",
    fichas: [
      {
        nombre: "Aprobar",
        contexto: "Solicitud de ingreso a una comunidad, en la lista de avisos.",
        archivo: "NotificationList.tsx · .jrApprove",
        usos: "3 apariciones",
        medidas: "#a855f7 · #fff",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "7px 16px",
              borderRadius: 8,
              background: "#a855f7",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Aceptar
          </button>
        ),
      },
      {
        nombre: "Rechazar",
        contexto: "El par del anterior, en el mismo aviso.",
        archivo: "NotificationList.tsx · .jrReject",
        usos: "3 apariciones",
        medidas: "blanco 0.1 · #f2f2f2",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "7px 16px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.1)",
              color: "#f2f2f2",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Rechazar
          </button>
        ),
      },
      {
        nombre: "Destructivo con borde",
        contexto: "Eliminar comunidad, borrar cuenta. Panel de administración.",
        archivo: "owner-admin-panel · .btnDanger",
        medidas: "borde #3d1515 · texto #f87171 · sin fondo",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "9px 16px",
              borderRadius: 10,
              background: "transparent",
              border: "1px solid #3d1515",
              color: "#f87171",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Eliminar comunidad
          </button>
        ),
      },
      {
        nombre: "Texto de peligro",
        contexto: "Salir de una comunidad, bloquear a alguien.",
        archivo: "firma inline",
        usos: "2 apariciones",
        medidas: "sin fondo · #ff8a8a",
        render: (
          <button
            type="button"
            style={{ ...baseBtn, background: "none", color: "#ff8a8a", fontSize: 13, fontWeight: 600, padding: 0 }}
          >
            Salir de la comunidad
          </button>
        ),
      },
    ],
  },

  {
    id: "wallet",
    titulo: "9 · Wallet",
    intro:
      "La wallet tiene su propio par primario y secundario, con borde — el único sitio del producto donde un botón sólido lleva borde.",
    fichas: [
      {
        nombre: "Wallet primario",
        contexto: "Retirar, cobrar. Tarjetas de finanzas y pendientes.",
        archivo: "WalletUi.tsx · .walletPrimaryBtn",
        usos: "5 apariciones",
        medidas: "#fff · #000 · radio 10 · borde blanco 0.16 · texto 13/700",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "#fff",
              color: "#000",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            Retirar
          </button>
        ),
      },
      {
        nombre: "Wallet secundario",
        contexto: "Ver detalle, descargar comprobante.",
        archivo: "WalletUi.tsx · .walletSecondaryBtn",
        usos: "6 apariciones",
        medidas: "blanco 0.05 · borde blanco 0.1 · texto 13/600",
        render: (
          <button
            type="button"
            style={{
              ...baseBtn,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.1,
            }}
          >
            Ver detalle
          </button>
        ),
      },
    ],
  },

  {
    id: "chips",
    titulo: "10 · Chips y pestañas",
    intro:
      "Selección, no acción. Aquí el estado activo es lo que hay que mirar, porque cada familia lo resuelve distinto — relleno, color de texto o subrayado.",
    fichas: [
      {
        nombre: "Chip de categoría",
        contexto: "Filtros del catálogo de avisos y de listas con categorías.",
        archivo: "AvisosCatalogo.tsx · .cat-btn",
        usos: "4 apariciones",
        medidas: "píldora 999 · borde blanco 0.16 · texto 12.5",
        render: (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{
                ...baseBtn,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "transparent",
                color: "inherit",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12.5,
              }}
            >
              Todos
            </button>
            <button
              type="button"
              style={{
                ...baseBtn,
                border: "1px solid rgba(168,85,247,0.6)",
                background: "rgba(168,85,247,0.14)",
                color: "#c084fc",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12.5,
              }}
            >
              Pagos
            </button>
          </div>
        ),
      },
      {
        nombre: "Pestaña de la wallet",
        contexto:
          "Las cinco del subnav de la wallet. El activo lo marca un subrayado que se desliza, no un relleno.",
        archivo: "WalletSubNav.tsx",
        medidas: "alto 56 · morado 0.55 inactivo · #c084fc activo · barra 3px",
        render: (
          <div style={{ display: "flex", gap: 4, position: "relative", paddingBottom: 10 }}>
            <span
              style={{
                ...baseBtn,
                padding: "0 12px 10px",
                color: "rgba(168,85,247,0.55)",
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              Finanzas
            </span>
            <span style={{ position: "relative", display: "inline-flex", flexDirection: "column" }}>
              <span
                style={{
                  ...baseBtn,
                  padding: "0 12px 10px",
                  color: "#c084fc",
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                Historial
              </span>
              <span
                style={{
                  position: "absolute",
                  bottom: 0,
                  insetInlineStart: "50%",
                  transform: "translateX(-50%)",
                  width: 56,
                  height: 3,
                  borderRadius: 999,
                  background: "#a855f7",
                }}
              />
            </span>
          </div>
        ),
      },
    ],
  },
];

/* ──────────────────────────────── Vista ──────────────────────────────── */

export default function BotonesCatalogo() {
  const [soloDuplicados, setSoloDuplicados] = useState(false);

  const totalFichas = FAMILIAS.reduce((n, f) => n + f.fichas.length, 0);
  const totalDuplicados = FAMILIAS.reduce(
    (n, f) => n + f.fichas.filter((x) => x.duplicaPrimitivo).length,
    0
  );

  return (
    <main className="bc-page">
      <style jsx>{`
        .bc-page {
          min-height: 100dvh;
          background: #000;
          color: #fff;
          font-family: inherit;
          padding: 28px 18px calc(60px + var(--vb-safe-bottom, 0px));
          box-sizing: border-box;
        }
        .bc-shell {
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
        }
        .bc-title {
          margin: 0;
          font-size: 40px;
          line-height: 1;
          letter-spacing: -0.04em;
          font-weight: 700;
        }
        .bc-sub {
          margin: 12px 0 0;
          font-size: 14px;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.6);
          max-width: 68ch;
        }
        .bc-stats {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
          gap: 8px;
          margin: 24px 0 0;
        }
        .bc-stat {
          border: 1px solid rgba(255, 255, 255, 0.09);
          border-radius: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.02);
        }
        .bc-stat-v {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.03em;
          color: #c084fc;
        }
        .bc-stat-l {
          font-size: 11px;
          line-height: 1.35;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 4px;
        }
        .bc-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin: 24px 0 0;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .bc-index {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin: 20px 0 0;
        }
        .bc-index :global(a) {
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.72);
          text-decoration: none;
        }
        .bc-fam {
          margin-top: 44px;
          scroll-margin-top: 18px;
        }
        .bc-fam-title {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .bc-fam-intro {
          margin: 8px 0 0;
          font-size: 13px;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.55);
          max-width: 72ch;
        }
        .bc-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
          gap: 14px;
          margin-top: 18px;
        }
        .bc-card {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.015);
          display: flex;
          flex-direction: column;
        }
        .bc-stage {
          min-height: 104px;
          display: grid;
          place-items: center;
          padding: 20px 16px;
          /* Cuadrícula tenue: deja ver el borde real del botón sobre el negro. */
          background-image: linear-gradient(
              rgba(255, 255, 255, 0.028) 1px,
              transparent 1px
            ),
            linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
          background-size: 14px 14px;
        }
        .bc-meta {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px 14px 14px;
        }
        .bc-name {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .bc-ctx {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.62);
        }
        .bc-file {
          margin-top: 8px;
          font-size: 10.5px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.34);
          word-break: break-word;
        }
        .bc-specs {
          margin-top: 8px;
          font-size: 10.5px;
          line-height: 1.5;
          color: rgba(168, 85, 247, 0.86);
        }
        .bc-tags {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .bc-tag {
          font-size: 10px;
          border-radius: 999px;
          padding: 3px 8px;
          background: rgba(255, 255, 255, 0.07);
          color: rgba(255, 255, 255, 0.6);
        }
        .bc-tag-dup {
          background: rgba(234, 179, 8, 0.14);
          color: #fde047;
        }
        .bc-note {
          margin-top: 48px;
          padding: 18px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          font-size: 12.5px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.6);
        }
        @media (max-width: 640px) {
          .bc-page {
            padding-inline: 12px;
          }
          .bc-title {
            font-size: 30px;
          }
          .bc-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="bc-shell">
        <h1 className="bc-title">Botones de Vibra</h1>
        <p className="bc-sub">
          Catálogo vivo de las {totalFichas} familias de botón que existen hoy en el
          producto, sacadas de un barrido real del repositorio. Cada ficha dice dónde
          aparece ese botón y con qué medidas. Sirve para decidir cuáles sobreviven
          cuando se cierre la escala del sistema de diseño.
        </p>

        <div className="bc-stats">
          {INVENTARIO.map((s) => (
            <div className="bc-stat" key={s.label}>
              <div className="bc-stat-v">{s.value}</div>
              <div className="bc-stat-l">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="bc-toolbar">
          <Button
            variant={soloDuplicados ? "brand" : "secondary"}
            size="sm"
            onClick={() => setSoloDuplicados((v) => !v)}
          >
            {soloDuplicados
              ? `Viendo las ${totalDuplicados} que duplican el primitivo`
              : "Ver solo lo que duplica el primitivo"}
          </Button>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            {totalDuplicados} de {totalFichas} familias reescriben algo que
            components/ui/Button ya resuelve.
          </span>
        </div>

        {!soloDuplicados && (
          <nav className="bc-index" aria-label="Índice de familias">
            {FAMILIAS.map((f) => (
              <a href={`#${f.id}`} key={f.id}>
                {f.titulo}
              </a>
            ))}
          </nav>
        )}

        {FAMILIAS.map((familia) => {
          const fichas = soloDuplicados
            ? familia.fichas.filter((f) => f.duplicaPrimitivo)
            : familia.fichas;
          if (fichas.length === 0) return null;

          return (
            <section className="bc-fam" id={familia.id} key={familia.id}>
              <h2 className="bc-fam-title">{familia.titulo}</h2>
              <p className="bc-fam-intro">{familia.intro}</p>

              <div className="bc-grid">
                {fichas.map((ficha) => (
                  <article className="bc-card" key={`${familia.id}-${ficha.nombre}`}>
                    <div className="bc-stage">{ficha.render}</div>
                    <div className="bc-meta">
                      <div className="bc-name">{ficha.nombre}</div>
                      <p className="bc-ctx">{ficha.contexto}</p>
                      <div className="bc-file">{ficha.archivo}</div>
                      <div className="bc-specs">{ficha.medidas}</div>
                      <div className="bc-tags">
                        {ficha.usos ? <span className="bc-tag">{ficha.usos}</span> : null}
                        {ficha.duplicaPrimitivo ? (
                          <span className="bc-tag bc-tag-dup">
                            ya existe · {ficha.duplicaPrimitivo}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}

        <div className="bc-note">
          <strong style={{ color: "rgba(255,255,255,0.86)" }}>Qué no está aquí.</strong>{" "}
          Los 389 botones que son un icono suelto sin estilo propio —heredan del
          contenedor y no forman familia— y las firmas con una sola aparición, que son
          casos únicos y no patrones. El catálogo cubre lo que se repite, que es lo que
          hay que unificar. Los botones se redibujan con sus medidas reales en vez de
          importarse de su sitio, porque casi todos viven dentro de componentes que
          arrastran sesión, datos o un panel abierto; la excepción es el primitivo, que
          se importa de verdad para que este catálogo se rompa si cambia.
        </div>
      </div>
    </main>
  );
}
