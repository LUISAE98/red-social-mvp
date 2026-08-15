"use client";

/**
 * Rail horizontal de comunidades para el OwnerSidebar.
 *
 * Sustituye a las pestañas plegables de "mis comunidades" y "comunidades que
 * sigo": en vez de una lista vertical que hay que desplegar, las comunidades se
 * ven siempre, en una tira que se desliza de lado.
 *
 * El orden lo decide QUIÉN FRECUENTAS MÁS. La lista llega ya ordenada por el
 * padre (`useSidebarVisitCounts`), que cuenta las visitas en localStorage; aquí
 * no se reordena nada.
 *
 * Tipo de entrada deliberadamente estrecho: solo los campos que la tarjeta pinta.
 * Así el componente vive en el árbol compartido sin depender de `GroupDocLite`,
 * que es un tipo interno del sidebar.
 */

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";

/** Compara ignorando mayúsculas y acentos: "Diseno" encuentra "Diseño". */
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Tarjetas por tanda. */
const PAGE_SIZE = 10;
/** Al llegar a esta tarjeta de la tanda, se pide la siguiente. */
const LOAD_MORE_AT = 6;

export type CommunityRailItem = {
  id: string;
  name?: string;
  ownerId?: string;
  avatarUrl?: string | null;
  /** Solo comunidades. Se pinta en el panel de lista completa, no en el rail. */
  visibility?: string;
  memberRole?: "owner" | "mod" | "member" | null;
  memberStatus?: "active" | "subscribed" | "muted" | "banned" | "removed" | null;
};

export default function CommunityRail({
  title,
  icon,
  items,
  currentUserId,
  newPostsCounts,
  onOpen,
  isMobile = false,
  showStatus = true,
  entityType = "group",
  loading = false,
  collapsible = false,
  seeAllLabel,
  emptySearchLabel,
}: {
  title: string;
  /**
   * Ícono del encabezado. Llega como prop en vez de importarse aquí: los íconos
   * del sidebar viven en `app/components/`, un árbol deprecado del que este
   * componente compartido no debe depender.
   */
  icon?: ReactNode;
  /** Ya ordenados por frecuencia de visita. */
  items: CommunityRailItem[];
  currentUserId: string | null;
  newPostsCounts: Record<string, number>;
  onOpen: (id: string) => void;
  isMobile?: boolean;
  /**
   * Muestra el punto y la etiqueta de estatus. Se apaga en "mis comunidades"
   * (soy la dueña, decirlo en cada tarjeta es ruido) y en perfiles seguidos,
   * donde no existe estado de membresía.
   */
  showStatus?: boolean;
  /** Decide el anillo del avatar: historias/live de comunidad o de persona. */
  entityType?: "group" | "profile";
  /** Pinta skeletons en vez de tarjetas mientras llega la primera tanda. */
  loading?: boolean;
  /**
   * Permite plegar el rail desde su encabezado. Se activa en laptop, donde el
   * sidebar compite por alto con el resto de la pantalla. En celular el sidebar
   * ES la pantalla: los tres rails van siempre abiertos y el encabezado no es
   * un botón, para no ofrecer un gesto que ahí no aporta nada.
   */
  collapsible?: boolean;
  /**
   * Texto del enlace "ver todas/todos" del encabezado, visible solo cuando el
   * rail está abierto. Llega como prop porque el género depende de lo que lista
   * cada rail: "Ver todos" los seguidos, "Ver todas" las comunidades.
   */
  seeAllLabel?: string;
  /** Texto cuando la búsqueda no encuentra nada. También depende del contenido. */
  emptySearchLabel?: string;
}) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const scrollerRef = useRef<HTMLDivElement>(null);

  // Paginación: se pinta de 10 en 10 y se amplía al acercarte al final de la
  // tanda visible, así una lista de cien comunidades no monta cien avatares
  // (cada uno con sus listeners de aro) para enseñar seis.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [open, setOpen] = useState(true);

  // Panel de "ver todas": la lista completa, con buscador. Sin paginar — aquí
  // vienes precisamente a encontrar algo que el rail no alcanzaba a mostrar.
  const [allOpen, setAllOpen] = useState(false);
  const [search, setSearch] = useState("");

  /**
   * Línea base para el globo de novedades del encabezado cerrado.
   *
   * `null` mientras el rail está abierto: si lo ves, no hay nada que avisar. Al
   * cerrarlo se congela el total del momento, y el globo enseña SOLO lo que
   * llegó después. Abrirlo vuelve a poner `null`, así que el aviso desaparece y
   * el conteo arranca de cero aunque no entres a ninguna comunidad.
   *
   * No se persiste a propósito: los rails arrancan abiertos en cada carga, así
   * que una línea base guardada no tendría a qué referirse.
   */
  const [newSinceClosed, setNewSinceClosed] = useState<number | null>(null);

  /**
   * Amplía la tanda cuando el borde derecho de lo visible se acerca al final de
   * lo cargado. El umbral es LOAD_MORE_AT tarjetas antes del final: con la tanda
   * de 10, empieza a cargar al llegar a la sexta.
   */
  const maybeLoadMore = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;

    setVisibleCount((current) => {
      if (current >= items.length) return current;

      const cardSpan = el.scrollWidth / Math.max(current, 1);
      const lastVisible = (Math.abs(el.scrollLeft) + el.clientWidth) / cardSpan;

      if (lastVisible < current - (PAGE_SIZE - LOAD_MORE_AT)) return current;

      return Math.min(current + PAGE_SIZE, items.length);
    });
  }, [items.length]);
  // Estado del arrastre en un ref, no en useState: se actualiza en cada
  // pointermove y re-renderizar la tira sesenta veces por segundo la haría
  // trepidar.
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, moved: 0 });

  /**
   * Arrastrar con el cursor (solo ratón).
   *
   * En celular no se toca nada: el navegador ya da scroll táctil con inercia, y
   * secuestrar el gesto lo empeoraría. Por eso se descarta todo lo que no sea
   * `pointerType === "mouse"`.
   */
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;

    const el = scrollerRef.current;
    if (!el) return;

    // 🚨 NO llamar a preventDefault() aquí. Cancela los eventos de ratón que el
    // navegador sintetiza después del pointerdown, incluido el `click`, y las
    // tarjetas dejan de navegar. El arrastre nativo de la imagen ya lo frenan
    // el `onDragStart` de la tira y el `-webkit-user-drag: none` del CSS.

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: 0,
    };

    // Captura el puntero para que el arrastre siga aunque el cursor se salga
    // de la tira.
    el.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag.active) return;

    const el = scrollerRef.current;
    if (!el) return;

    const dx = e.clientX - drag.startX;
    drag.moved = Math.max(drag.moved, Math.abs(dx));

    // Delta relativo al scroll inicial: funciona igual en RTL, donde el signo de
    // scrollLeft cambia según el navegador.
    el.scrollLeft = drag.startScroll - dx;

    // Amplía mientras arrastras, no solo al soltar: si la tanda se acabara a
    // media pasada, la tira frenaría en seco contra el final.
    maybeLoadMore();
  }

  function handlePointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag.active) return;

    drag.active = false;

    const el = scrollerRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  /**
   * Un arrastre no debe abrir la comunidad sobre la que soltaste. El click llega
   * después del pointerup, así que aquí ya sabemos cuánto se movió: si pasó el
   * umbral, se traga el click. Por debajo de 5px se considera clic normal, para
   * no castigar el temblor de la mano.
   */
  function handleClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current.moved > 5) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // Con lista vacía y sin carga en curso el rail no existe: un encabezado
  // solitario sobre un hueco no informa de nada.
  if (items.length === 0 && !loading) return null;

  const visibleItems = items.slice(0, visibleCount);

  // Total de novedades del rail y lo que corresponde enseñar en el globo.
  const totalNewPosts = items.reduce(
    (sum, item) => sum + (newPostsCounts[item.id] ?? 0),
    0
  );
  const badgeCount =
    newSinceClosed == null ? 0 : Math.max(0, totalNewPosts - newSinceClosed);

  // El panel conserva el orden del rail (en vivo, novedades, historias,
  // frecuencia) y solo filtra por texto.
  const query = normalizeForSearch(search);
  const filteredItems = query
    ? items.filter((item) =>
        normalizeForSearch(item.name ?? "").includes(query)
      )
    : items;

  const avatarSize = isMobile ? 60 : 52;
  // La tarjeta se ciñe al avatar (+10px de respiro). Antes sobraban casi 30px a
  // los lados, pensados para un nombre que ya no se pinta, y eso dejaba los
  // avatares nadando. Las etiquetas más largas ("Moderador") se recortan con
  // puntos suspensivos en vez de ensanchar toda la fila.
  const cardWidth = avatarSize + 10;

  /**
   * Qué soy en esta comunidad. El ROL manda sobre el estado: si soy dueña o
   * moderadora eso es lo informativo, no que además esté "activa". Para el resto
   * cae al estado de membresía, y sin dato se asume miembro al corriente — está
   * en mi lista, así que pertenezco.
   */
  function statusLabel(item: CommunityRailItem): string {
    const isOwner =
      item.memberRole === "owner" ||
      (currentUserId != null && item.ownerId === currentUserId);

    if (isOwner) return tGroups("roleOwner");
    if (item.memberRole === "mod") return tGroups("roleMod");

    switch (item.memberStatus) {
      case "subscribed":
        return tGroups("statusSubscribed");
      case "muted":
        return tGroups("statusMuted");
      case "banned":
        return tGroups("statusBanned");
      case "removed":
        return tGroups("statusRemoved");
      default:
        return tGroups("statusActive");
    }
  }

  /**
   * Color del punto de estatus. Verde al corriente, azul suscrito, ámbar
   * muteado, rojo baneado o expulsado.
   *
   * Los valores son los mismos que `statusDotColor` de
   * `OwnerSidebarOtherGroups.parts`, la pestaña que estos rails sustituyeron. Se
   * repiten aquí en vez de importarlos porque aquel archivo vive en
   * `app/components/`, un árbol deprecado del que el árbol compartido no debe
   * depender. Si esa pestaña se borra, esta queda como la única copia viva.
   */
  function statusDotColor(item: CommunityRailItem): string {
    const isOwner =
      item.memberRole === "owner" ||
      (currentUserId != null && item.ownerId === currentUserId);

    // Dueña o moderadora: no hay estado de membresía que matizar, están dentro.
    if (isOwner || item.memberRole === "mod") return "#22c55e";

    switch (item.memberStatus) {
      case "subscribed":
        return "#38bdf8";
      case "muted":
        return "#f5a623";
      case "banned":
        return "#ef4444";
      case "removed":
        return "#b91c1c";
      default:
        return "#22c55e";
    }
  }

  // Título en caja normal (la traducción ya viene con la inicial en mayúscula) y
  // de trazo ligero: es una etiqueta que ordena, no un encabezado que compita
  // con los avatares.
  /** Etiquetas cortas de visibilidad para el panel de lista completa. */
  function visibilityLabel(visibility?: string): string | null {
    if (visibility === "public") return tGroups("publicLabel");
    if (visibility === "private") return tGroups("privateLabel");
    if (visibility === "hidden") return tGroups("hiddenLabel");
    return null;
  }

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 8px 6px",
    fontSize: 13,
    fontWeight: 400,
    color: "rgba(255,255,255,0.74)",
  };

  const scrollerStyle: CSSProperties = {
    display: "flex",
    gap: 3,
    padding: "0 6px 4px",
    overflowX: "auto",
    overflowY: "hidden",
    WebkitOverflowScrolling: "touch" as CSSProperties["WebkitOverflowScrolling"],
    scrollbarWidth: "none",
    // Sin scroll-snap: al arrastrar con el cursor, el imán peleaba contra el
    // movimiento y daba la sensación de tirones. El deslizamiento libre se
    // siente más suave y aquí no hay nada que valga alinear.
    // Sin esto, arrastrar con el ratón selecciona las etiquetas de estatus y
    // deja la tira llena de texto resaltado en azul.
    userSelect: "none",
  };

  const cardStyle: CSSProperties = {
    flexShrink: 0,
    width: cardWidth,
    display: "grid",
    justifyItems: "center",
    gap: 3,
    padding: "6px 2px 8px",
    borderRadius: 14,
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "center",
    WebkitTapHighlightColor: "transparent",
  };

  const metaStyle: CSSProperties = {
    fontSize: 10,
    lineHeight: 1.25,
    color: "rgba(255,255,255,0.62)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  };

  return (
    <section style={{ minWidth: 0 }} aria-label={title}>
      <style jsx>{`
        /* Skeleton canónico de vibra_style.md. Se redefine aquí porque
           styled-jsx scopea por componente: la copia de OwnerSidebar no alcanza
           a los hijos. Relleno y onda son los de la guía, sin tocar. */
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
          0% {
            background-position: 180% 0;
          }
          100% {
            background-position: -80% 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-skel {
            animation: none;
            background: rgba(255, 255, 255, 0.07);
          }
        }

        /* Placeholder canónico de Vibra (vibra_style.md): atenuado en 0.42,
           con opacity 1 para que Firefox no lo baje todavía más. */
        .communityRailSearch::placeholder {
          color: rgba(255, 255, 255, 0.42);
          opacity: 1;
        }

        /* Sin barra visible: la tira se desliza con el dedo, con trackpad o
           arrastrando con el cursor. */
        .communityRailScroller::-webkit-scrollbar {
          display: none;
        }

        /* Los avatares no se arrastran como imágenes sueltas: el gesto es de la
           tira. El preventDefault del pointerdown cubre Blink y WebKit; esto
           cubre el resto y evita el fantasma de la foto siguiendo al cursor. */
        .communityRailScroller :global(img) {
          -webkit-user-drag: none;
          user-select: none;
        }

        /* La mano de agarre solo tiene sentido donde hay cursor. */
        @media (hover: hover) and (pointer: fine) {
          .communityRailScroller {
            cursor: grab;
          }

          .communityRailScroller:active {
            cursor: grabbing;
          }
        }
      `}</style>

      {(() => {
        const headerInner = (
          <>
            {icon ? (
              <span style={{ display: "inline-flex", flexShrink: 0, opacity: 0.9 }}>{icon}</span>
            ) : null}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "start",
              }}
            >
              {title}
            </span>

            {/* Cerrado, un "+" para volver a abrir. Abierto, el enlace de "ver
                todas", con el mismo tratamiento que el de Mensajes.

                TODO: el enlace aún no lleva a ningún sitio; falta decidir su
                destino. `stopPropagation` para que pulsarlo no pliegue el rail
                al que pertenece. */}
            {/* El "+" solo existe donde se puede plegar (laptop) y solo cuando
                está cerrado. El enlace de "ver todas" NO depende de eso: en
                celular, donde los rails van siempre abiertos, es la única
                puerta a la lista completa. */}
            {/* Globo de novedades: solo con el rail cerrado, porque abierto ya
                las estás viendo en las tarjetas. */}
            {collapsible && !open && badgeCount > 0 ? (
              <span
                style={{
                  flexShrink: 0,
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 999,
                  background: "#a855f7",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  boxSizing: "border-box",
                }}
              >
                {badgeCount > 99 ? "99+" : badgeCount}
              </span>
            ) : null}

            {collapsible && !open ? (
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  fontSize: 17,
                  lineHeight: 1,
                  fontWeight: 400,
                  color: "rgba(255,255,255,0.62)",
                }}
              >
                +
              </span>
            ) : seeAllLabel ? (
              <span
                    role="link"
                    tabIndex={0}
                    // stopPropagation: el encabezado entero pliega el rail, y sin
                    // esto pulsar "ver todas" lo cerraría en vez de abrir la lista.
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearch("");
                      setAllOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      setSearch("");
                      setAllOpen(true);
                    }}
                    style={{
                      flexShrink: 0,
                      color: "#a855f7",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    {seeAllLabel}
              </span>
            ) : null}
          </>
        );

        // En celular no es un botón: no hay nada que plegar, y un control que
        // no hace nada confunde al lector de pantalla.
        return collapsible ? (
          <button
            type="button"
            onClick={() => {
              setOpen((prev) => {
                const next = !prev;
                // Al cerrar se congela el total actual como línea base; al abrir
                // se suelta, y con ello el globo desaparece y vuelve a cero.
                setNewSinceClosed(next ? null : totalNewPosts);
                return next;
              });
            }}
            aria-expanded={open}
            style={{
              ...headerStyle,
              width: "100%",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {headerInner}
          </button>
        ) : (
          <div style={headerStyle}>{headerInner}</div>
        );
      })()}

      {/* Plegado: 0fr→1fr anima hasta la altura real del contenido, sin tope
          fijo que lo recorte. Mismo patrón que el resto del sidebar. La tira
          interior conserva su overflow-x, así que el scroll horizontal sigue
          funcionando dentro del contenedor que se abre y cierra. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: !collapsible || open ? "1fr" : "0fr",
          opacity: !collapsible || open ? 1 : 0,
          transition:
            "grid-template-rows 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease",
        }}
      >
        <div style={{ overflow: "hidden", minWidth: 0 }}>
      <div
        ref={scrollerRef}
        className="communityRailScroller"
        style={scrollerStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClickCapture={handleClickCapture}
        // Cubre el deslizamiento táctil y la rueda del trackpad, que no pasan
        // por los manejadores de puntero.
        onScroll={maybeLoadMore}
        // Red de seguridad para Firefox, que puede lanzar el arrastre nativo
        // pese al preventDefault del pointerdown.
        onDragStart={(e) => e.preventDefault()}
      >
        {loading && items.length === 0
          ? // Skeletons con la base canónica de vibra_style.md: la clase global
            // .vb-skel aporta el relleno y la onda vbSkelWave; aquí solo se
            // define la FORMA (círculo del avatar y línea del estatus).
            Array.from({ length: 4 }, (_, i) => (
              <div key={`skel-${i}`} style={{ ...cardStyle, cursor: "default" }}>
                <div
                  className="vb-skel"
                  style={{
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: "50%",
                  }}
                />
                <div
                  className="vb-skel"
                  style={{ width: "72%", height: 9, borderRadius: 6, marginTop: 3 }}
                />
              </div>
            ))
          : null}

        {visibleItems.map((item) => {
          const newPosts = newPostsCounts[item.id] ?? 0;
          // El nombre ya no se pinta bajo el avatar, pero sigue haciendo falta:
          // es el `title` al pasar el cursor, el texto alternativo del avatar y
          // lo que lee un lector de pantalla en el botón.
          const name = item.name?.trim() || tGroups("noName");

          return (
            <button
              key={item.id}
              type="button"
              style={cardStyle}
              onClick={() => onOpen(item.id)}
              title={name}
              aria-label={name}
            >
              <span style={{ position: "relative", display: "inline-flex" }}>
                <LiveRingAvatar
                  entityId={item.id}
                  entityType={entityType}
                  currentUserId={currentUserId}
                  photoURL={item.avatarUrl ?? null}
                  displayName={name}
                  size={avatarSize}
                  // El avatar monta su propio <button> para abrir historias o el
                  // live. Sin este onClick, cuando NO hay ni una cosa ni la otra
                  // se queda sin acción y el clic muere ahí en vez de navegar.
                  onClick={() => onOpen(item.id)}
                />
              </span>

              {showStatus ? (
                <span
                  style={{
                    ...metaStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: statusDotColor(item),
                      flexShrink: 0,
                    }}
                  />
                  {statusLabel(item)}
                </span>
              ) : null}

              {newPosts > 0 ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1.25,
                    color: "#a855f7",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }}
                >
                  {tCommon("newPostsCount", { count: newPosts })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
        </div>
      </div>

      {/* Lista completa. VibraResponsivePanel ya resuelve las dos formas que
          pediste: panel centrado en laptop y pestaña deslizable desde abajo en
          celular (su `mobileVariant` por omisión). */}
      <VibraResponsivePanel
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={title}
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={420}
      >
        <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
          <input
            className="communityRailSearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tCommon("search")}
            // Sin autoFocus: en celular abriría el teclado de golpe y taparía
            // media lista antes de que llegues a verla.
            style={{
              width: "100%",
              minHeight: 44,
              padding: "10px 12px",
              borderRadius: 12,
              border: "none",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              outline: "none",
              fontSize: 14,
              fontFamily: "inherit",
              boxSizing: "border-box",
              WebkitAppearance: "none",
              appearance: "none",
            }}
          />

          {filteredItems.length === 0 ? (
            <div
              style={{
                padding: "18px 4px",
                textAlign: "center",
                fontSize: 13,
                color: "rgba(255,255,255,0.5)",
                lineHeight: 1.45,
              }}
            >
              {emptySearchLabel ?? tGroups("noGroupsFound")}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              {filteredItems.map((item) => {
                const newPosts = newPostsCounts[item.id] ?? 0;
                const name = item.name?.trim() || tGroups("noName");

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setAllOpen(false);
                      onOpen(item.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 6px",
                      borderRadius: 12,
                      border: "none",
                      background: "transparent",
                      color: "#fff",
                      textAlign: "start",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      minWidth: 0,
                    }}
                  >
                    <LiveRingAvatar
                      entityId={item.id}
                      entityType={entityType}
                      currentUserId={currentUserId}
                      photoURL={item.avatarUrl ?? null}
                      displayName={name}
                      size={40}
                      onClick={() => {
                        setAllOpen(false);
                        onOpen(item.id);
                      }}
                    />

                    <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.94)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {name}
                      </span>

                      {/* Bajo el nombre: qué tipo de comunidad es y, seguido, el
                          aviso de contenido nuevo en el mismo morado y formato
                          que en el rail. */}
                      {visibilityLabel(item.visibility) || newPosts > 0 ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11,
                            lineHeight: 1.3,
                            color: "rgba(255,255,255,0.55)",
                            minWidth: 0,
                          }}
                        >
                          {visibilityLabel(item.visibility) ? (
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {visibilityLabel(item.visibility)}
                            </span>
                          ) : null}

                          {newPosts > 0 ? (
                            <span
                              style={{
                                flexShrink: 0,
                                fontWeight: 700,
                                color: "#a855f7",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {tCommon("newPostsCount", { count: newPosts })}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>

                    {/* El estatus cierra el renglón, alineado a la derecha. */}
                    {showStatus ? (
                      <span
                        style={{
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 11,
                          color: "rgba(255,255,255,0.6)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: statusDotColor(item),
                            flexShrink: 0,
                          }}
                        />
                        {statusLabel(item)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </VibraResponsivePanel>
    </section>
  );
}
