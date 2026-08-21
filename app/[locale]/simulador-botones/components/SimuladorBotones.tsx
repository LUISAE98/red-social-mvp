"use client";

/**
 * Simulador de botones: cada fila monta el componente REAL, importado de donde
 * vive. No hay ni una sola copia redibujada aquí.
 *
 * Dos formas de montarlo, según lo que sea el componente:
 *
 *  · En la celda — los que caben en un renglón (primitivos, subnavs, toggles).
 *  · Encima — los modales, hojas y visores que se dibujan a pantalla completa.
 *    La celda lleva un disparador y el componente real se abre sobre la página.
 *    Ahí dentro los botones son los de verdad, en su sitio de verdad.
 *
 * Lo que NO está: los 604 botones que necesitan un usuario autenticado para
 * montarse, y las páginas completas (`page.tsx` de admin), que no son
 * componentes y no caben en una fila.
 *
 * Las filas marcadas en rojo actúan de verdad al pulsarlas.
 */

import { useState, type ReactNode } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";

import LogoutButton from "@/app/LogoutButton";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import NotificationTabs from "@/app/components/Notifications/NotificationTabs";
import ReportModal from "@/app/components/ReportModal/ReportModal";
import CoverSearchBar from "@/app/components/CoverSearch/CoverSearchBar";
import SearchDateFilterMenu from "@/app/components/SearchToolbar/SearchDateFilterMenu";
import SearchSubnav from "@/app/components/SearchToolbar/SearchSubnav";
import GroupsSearchToolbar from "@/app/components/SearchToolbar/GroupsSearchToolbar";
import StoryCircle from "@/app/components/Stories/StoryCircle";
import MessagePolicySetting from "@/components/chat/MessagePolicySetting";
import type { MessagePolicy } from "@/lib/chat/types";
import LegalDocPanel from "@/components/legal/LegalDocPanel";
import LegalLinksFooter from "@/components/legal/LegalLinksFooter";
import ImageCropperModal from "@/components/media/ImageCropperModal";
import PaymentSuccessCard from "@/components/payments/PaymentSuccessCard";
import FollowStateButton from "@/components/profile/FollowStateButton";
import ServicePublishedSuccess from "@/components/services/ServicePublishedSuccess";
import { Button } from "@/components/ui";
import ConfirmPanel from "@/components/ui/ConfirmPanel";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import EditTextButton from "@/components/ui/EditTextButton";
import OptionWheelPanel from "@/components/ui/OptionWheelPanel";
import PostSaveButton from "@/components/ui/PostSaveButton";
import PostShareButton from "@/components/ui/PostShareButton";
import StatsRow from "@/components/ui/StatsRow";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import WheelPanel from "@/components/ui/WheelPanel";

import DonationViewer from "../../(protected)/u/[handle]/components/DonationViewer";
import ProfileSubnav from "../../(protected)/u/[handle]/components/ProfileSubnav/ProfileSubnav";
import ScheduleDateTimeSelector from "../../(protected)/wallet/components/ScheduleDateTimeSelector";
import WalletPhonePreview from "../../(protected)/wallet/components/WalletPhonePreview";
import WalletScopeToggle from "../../(protected)/wallet/components/WalletScopeToggle";
import LoginCommunityCards from "../../(public)/login/LoginCommunityCards";
import LoginFaq from "../../(public)/login/LoginFaq";
import GroupSubnav from "../../groups/[groupId]/components/GroupSubnav";
import PostFlamesPanel from "../../groups/[groupId]/components/posts/PostFlamesPanel";
import PostImageViewer from "../../groups/[groupId]/components/posts/PostImageViewer";
import PostsMediaSubnav from "../../groups/[groupId]/components/posts/PostsMediaSubnav";

import { AUTOR_DEMO, IMAGEN_DEMO, POST_DEMO, USUARIOS_FLAMA } from "./datosDeMentira";

type Fila = {
  id: string;
  /** Se dibuja dentro de la celda. */
  boton?: ReactNode;
  /** Se abre encima de la página; recibe el cierre. */
  overlay?: (cerrar: () => void) => ReactNode;
  /** Texto del disparador cuando es overlay. */
  abrir?: string;
  ubicacion: string;
  archivo: string;
  hace: string;
  aviso?: string;
};

type Bloque = { titulo: string; intro: string; filas: Fila[] };

const noop = () => {};

function CajaPortada({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 132,
        height: 62,
        borderRadius: 10,
        background: "linear-gradient(135deg, #2a1740, #4c1d95)",
      }}
    >
      {children}
    </div>
  );
}

/** Marco oscuro para los que se dibujan a ancho completo sobre negro. */
function CajaAncha({ children, alto = 96 }: { children: ReactNode; alto?: number }) {
  return (
    <div
      style={{
        width: 320,
        maxHeight: alto,
        overflow: "hidden",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#000",
      }}
    >
      {children}
    </div>
  );
}

export default function SimuladorBotones() {
  const [guardado, setGuardado] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  /* Estado de los controles que necesitan uno para funcionar de verdad. */
  const [tabPerfil, setTabPerfil] = useState<"posts" | "groups" | "services" | "settings">("posts");
  const [tabGrupo, setTabGrupo] = useState<"feed" | "members" | "services" | "settings">("feed");
  const [tabMedia, setTabMedia] = useState<"feed" | "photos" | "videos" | "lives">("feed");
  const [tabBusqueda, setTabBusqueda] = useState<"groups" | "profiles" | "posts" | "stories">("stories");
  const [tabNotif, setTabNotif] = useState<"experiences" | "social">("experiences");
  const [alcance, setAlcance] = useState<"all" | "30d">("all");
  const [politica, setPolitica] = useState<MessagePolicy>("everyone");
  const [rueda, setRueda] = useState("mxn");
  const [busqueda, setBusqueda] = useState("");
  const [agenda, setAgenda] = useState({ day: "24", month: "12", year: "2026", hour: "18", minute: "30" });

  const cerrar = () => setAbierto(null);

  const bloques: Bloque[] = [
    /* ─────────────────────────────── 1 ─────────────────────────────── */
    {
      titulo: "El primitivo",
      intro:
        "Las seis variantes y los tres tamaños de components/ui/Button.tsx. Es la fuente única del estilo de botón, y hoy solo lo importan dos archivos del producto.",
      filas: [
        {
          id: "b-primary",
          boton: <Button variant="primary">Crear comunidad</Button>,
          ubicacion: "Acción principal de una pantalla",
          archivo: "components/ui/Button.tsx — variant primary",
          hace: "Fondo blanco sobre texto oscuro. La acción que se quiere que la persona haga.",
        },
        {
          id: "b-brand",
          boton: <Button variant="brand">Guardar</Button>,
          ubicacion: "Formularios y paneles de ajustes",
          archivo: "components/ui/Button.tsx — variant brand",
          hace: "Morado sólido de marca. Confirma sin gritar tanto como el blanco.",
        },
        {
          id: "b-gradient",
          boton: <Button variant="gradient">Suscribirme</Button>,
          ubicacion: "Suscripciones, compras y monetización",
          archivo: "components/ui/Button.tsx — variant gradient",
          hace: "Degradado rosa→morado→azul. Reservado para el momento en que entra dinero.",
        },
        {
          id: "b-secondary",
          boton: <Button variant="secondary">Ver detalles</Button>,
          ubicacion: "Acción de apoyo junto a la principal",
          archivo: "components/ui/Button.tsx — variant secondary",
          hace: "Superficie translúcida. Acompaña sin competir con el botón principal.",
        },
        {
          id: "b-ghost",
          boton: (
            <Button variant="ghost" size="sm">
              Cancelar
            </Button>
          ),
          ubicacion: "Salida de modales y hojas inferiores",
          archivo: "components/ui/Button.tsx — variant ghost",
          hace: "Transparente. Cierra o descarta sin sugerir que sea lo que toca hacer.",
        },
        {
          id: "b-danger",
          boton: <Button variant="danger">Eliminar comunidad</Button>,
          ubicacion: "Zona de peligro de comunidades y cuenta",
          archivo: "components/ui/Button.tsx — variant danger",
          hace: "Rojo. Destruye algo que no se recupera; siempre detrás de una confirmación.",
        },
        {
          id: "b-loading",
          boton: (
            <Button variant="brand" loading>
              Guardando
            </Button>
          ),
          ubicacion: "Cualquier acción con espera de red",
          archivo: "components/ui/Button.tsx — prop loading",
          hace: "Muestra el spinner, marca aria-busy y se bloquea para evitar el doble envío.",
        },
        {
          id: "b-disabled",
          boton: (
            <Button variant="brand" disabled>
              Publicar
            </Button>
          ),
          ubicacion: "Formularios incompletos",
          archivo: "components/ui/Button.tsx — prop disabled",
          hace: "Gris apagado y cursor bloqueado mientras faltan datos obligatorios.",
        },
        {
          id: "b-sm",
          boton: (
            <Button variant="brand" size="sm">
              sm
            </Button>
          ),
          ubicacion: "Filas de lista y barras densas",
          archivo: "components/ui/Button.tsx — size sm",
          hace: "Relleno 6/12 px, texto de 13 px, radio 10.",
        },
        {
          id: "b-md",
          boton: (
            <Button variant="brand" size="md">
              md
            </Button>
          ),
          ubicacion: "Tamaño por defecto",
          archivo: "components/ui/Button.tsx — size md",
          hace: "Relleno 10/16 px, texto de 14 px, radio 12.",
        },
        {
          id: "b-lg",
          boton: (
            <Button variant="brand" size="lg">
              lg
            </Button>
          ),
          ubicacion: "Acción única de una hoja inferior",
          archivo: "components/ui/Button.tsx — size lg",
          hace: "Relleno 13/20 px, texto de 16 px, radio 14.",
        },
      ],
    },

    /* ─────────────────────────────── 2 ─────────────────────────────── */
    {
      titulo: "Botones de publicación",
      intro: "Los que rodean a un post, en el feed de la comunidad y en el perfil.",
      filas: [
        {
          id: "post-save",
          boton: (
            <PostSaveButton
              count={guardado ? 13 : 12}
              saved={guardado}
              onClick={() => setGuardado((v) => !v)}
            />
          ),
          ubicacion: "Barra de acciones de la publicación",
          archivo: "components/ui/PostSaveButton.tsx",
          hace: "Guarda la publicación en la lista personal y sube el contador. Púlsalo, alterna de verdad.",
        },
        {
          id: "post-share",
          boton: <PostShareButton postId="demo-post" />,
          ubicacion: "Barra de acciones de la publicación",
          archivo: "components/ui/PostShareButton.tsx",
          hace: "Arma la URL pública del post, la comparte con el menú del sistema o la copia, y avisa con un toast.",
        },
        {
          id: "copy-link",
          boton: <CopyLinkButton href="/es/groups/demo" label="Copiar enlace" />,
          ubicacion: "Compartir comunidad, perfil o sesión",
          archivo: "components/ui/CopyLinkButton.tsx",
          hace: "Copia el enlace absoluto al portapapeles y cambia a «¡Copiado!» un momento.",
        },
        {
          id: "copy-link-icon",
          boton: <CopyLinkButton href="/es/groups/demo" iconOnly />,
          ubicacion: "Cabeceras estrechas",
          archivo: "components/ui/CopyLinkButton.tsx — prop iconOnly",
          hace: "Lo mismo, sin texto, cuando no hay sitio para la etiqueta.",
        },
        {
          id: "post-viewer",
          abrir: "Abrir el visor",
          overlay: (c) => (
            <PostImageViewer
              open
              isMobile={false}
              image={{ url: IMAGEN_DEMO, altText: "Imagen de mentira" }}
              post={POST_DEMO}
              author={AUTOR_DEMO}
              relativeDate="hace 2 h"
              exactDate="16 ago 2026, 14:20"
              likesCount={128}
              commentsCount={9}
              savesCount={12}
              showActionsMenu
              onClose={c}
              onToggleFlame={noop}
              onOpenComments={noop}
              onOpenFlames={noop}
              onToggleSave={noop}
            />
          ),
          ubicacion: "Visor a pantalla completa de la foto de un post",
          archivo: "app/[locale]/groups/[groupId]/components/posts/PostImageViewer.tsx",
          hace: "El archivo con más botones sin sesión, 32. Dentro están flama, comentar, guardar, compartir, navegar entre archivos, cambiar el formato de la fecha y el menú de tres puntos.",
        },
        {
          id: "flames",
          abrir: "Ver quién dio flama",
          overlay: (c) => (
            <PostFlamesPanel open users={USUARIOS_FLAMA} onClose={c} />
          ),
          ubicacion: "Al tocar el contador de flamas de un post",
          archivo: "app/[locale]/groups/[groupId]/components/posts/PostFlamesPanel.tsx",
          hace: "Lista de quienes dieron flama, con su botón de cerrar.",
        },
      ],
    },

    /* ─────────────────────────────── 3 ─────────────────────────────── */
    {
      titulo: "Navegación por pestañas",
      intro:
        "Los subnavs. Todos guardan estado, así que aquí cambian de pestaña de verdad al pulsarlos.",
      filas: [
        {
          id: "subnav-perfil",
          boton: (
            <CajaAncha>
              <ProfileSubnav activeTab={tabPerfil} onChange={setTabPerfil} isOwner />
            </CajaAncha>
          ),
          ubicacion: "Perfil de una persona",
          archivo: "app/[locale]/(protected)/u/[handle]/components/ProfileSubnav/ProfileSubnav.tsx",
          hace: "Publicaciones · Comunidades · Servicios · Ajustes. Las dos últimas solo las ve quien es dueño del perfil.",
        },
        {
          id: "subnav-grupo",
          boton: (
            <CajaAncha>
              <GroupSubnav activeTab={tabGrupo} onChange={setTabGrupo} canManage />
            </CajaAncha>
          ),
          ubicacion: "Dentro de una comunidad",
          archivo: "app/[locale]/groups/[groupId]/components/GroupSubnav.tsx",
          hace: "Publicaciones · Miembros · Servicios · Ajustes. La última solo para quien administra.",
        },
        {
          id: "subnav-media",
          boton: (
            <CajaAncha>
              <PostsMediaSubnav active={tabMedia} onChange={setTabMedia} />
            </CajaAncha>
          ),
          ubicacion: "Pestaña de publicaciones",
          archivo: "app/[locale]/groups/[groupId]/components/posts/PostsMediaSubnav.tsx",
          hace: "Filtra el feed entre todo, fotos, videos y lives.",
        },
        {
          id: "subnav-busqueda",
          boton: (
            <CajaAncha>
              <SearchSubnav activeTab={tabBusqueda} onChangeTab={setTabBusqueda} />
            </CajaAncha>
          ),
          ubicacion: "Buscador global",
          archivo: "app/components/SearchToolbar/SearchSubnav.tsx",
          hace: "Historias · Perfiles · Comunidades · Publicaciones.",
        },
        {
          id: "subnav-notif",
          boton: (
            <CajaAncha>
              <NotificationTabs activeTab={tabNotif} onChange={setTabNotif} counts={{ experiences: 3 }} />
            </CajaAncha>
          ),
          ubicacion: "Página de notificaciones y panel de la campanita",
          archivo: "app/components/Notifications/NotificationTabs.tsx",
          hace: "Experiencias · Sociales, con el conteo al lado del título. Un solo componente para las dos pantallas.",
        },
      ],
    },

    /* ─────────────────────────────── 4 ─────────────────────────────── */
    {
      titulo: "Selectores y filtros",
      intro: "Interruptores, ruedas y menús de filtro. Todos funcionan de verdad aquí.",
      filas: [
        {
          id: "wallet-scope",
          boton: <WalletScopeToggle value={alcance} onChange={setAlcance} />,
          ubicacion: "Estadísticas de la wallet",
          archivo: "app/[locale]/(protected)/wallet/components/WalletScopeToggle.tsx",
          hace: "Alterna las cifras entre todo el histórico y los últimos 30 días.",
        },
        {
          id: "msg-policy",
          boton: (
            <CajaAncha alto={150}>
              <MessagePolicySetting value={politica} onChange={setPolitica} />
            </CajaAncha>
          ),
          ubicacion: "Ajustes de mensajes directos",
          archivo: "components/chat/MessagePolicySetting.tsx",
          hace: "Decide quién puede escribirte, cualquiera, solo a quien sigues o nadie.",
        },
        {
          id: "fecha-filtro",
          boton: <SearchDateFilterMenu fromDate="" toDate="" onApply={noop} />,
          ubicacion: "Buscador global, filtro por fecha",
          archivo: "app/components/SearchToolbar/SearchDateFilterMenu.tsx",
          hace: "Abre el rango de fechas y aplica el filtro. Cuatro botones dentro.",
        },
        {
          id: "agenda",
          boton: (
            <CajaAncha alto={120}>
              <ScheduleDateTimeSelector value={agenda} onChange={setAgenda} />
            </CajaAncha>
          ),
          ubicacion: "Agendar una sesión o un retiro",
          archivo: "app/[locale]/(protected)/wallet/components/ScheduleDateTimeSelector.tsx",
          hace: "Abre las ruedas de fecha y de hora.",
        },
        {
          id: "rueda-opciones",
          abrir: "Abrir la rueda",
          overlay: (c) => (
            <OptionWheelPanel
              value={rueda}
              onChange={(v) => {
                setRueda(v);
                c();
              }}
              options={[
                { value: "mxn", label: "Peso mexicano" },
                { value: "usd", label: "Dólar" },
                { value: "eur", label: "Euro" },
              ]}
              title="Elegir moneda"
              confirmLabel="Confirmar"
              closeAriaLabel="Cerrar"
            />
          ),
          ubicacion: "Elegir una opción de una lista larga",
          archivo: "components/ui/OptionWheelPanel.tsx",
          hace: "Rueda de una columna, con confirmar y cerrar.",
        },
        {
          id: "rueda-panel",
          abrir: "Abrir el panel",
          overlay: (c) => (
            <WheelPanel
              open
              onClose={c}
              onConfirm={c}
              title="Elegir duración"
              confirmLabel="Confirmar"
              closeAriaLabel="Cerrar"
              columns={[
                {
                  key: "min",
                  label: "Minutos",
                  value: "15",
                  onChange: noop,
                  items: [
                    { value: "15", label: "15 min" },
                    { value: "30", label: "30 min" },
                    { value: "60", label: "60 min" },
                  ],
                },
              ]}
            />
          ),
          ubicacion: "Base de todas las ruedas de la plataforma",
          archivo: "components/ui/WheelPanel.tsx",
          hace: "El contenedor con confirmar y cerrar sobre el que se montan las demás ruedas.",
        },
      ],
    },

    /* ─────────────────────────────── 5 ─────────────────────────────── */
    {
      titulo: "Modales y hojas",
      intro:
        "Se dibujan a pantalla completa, así que el disparador los abre encima de esta página. Los botones de dentro son los reales.",
      filas: [
        {
          id: "confirm",
          abrir: "Abrir confirmación",
          overlay: (c) => (
            <ConfirmPanel
              open
              onClose={c}
              onConfirm={c}
              tone="danger"
              title="¿Eliminar la comunidad?"
              body="Se borran las publicaciones, los miembros y los servicios. No se puede deshacer."
              confirmLabel="Eliminar"
              cancelLabel="Cancelar"
            />
          ),
          ubicacion: "Cualquier acción destructiva",
          archivo: "components/ui/ConfirmPanel.tsx",
          hace: "El confirmar canónico. Dos botones, confirmar y cancelar, con el tono de peligro.",
        },
        {
          id: "panel",
          abrir: "Abrir el panel",
          overlay: (c) => (
            <VibraResponsivePanel
              open
              onClose={c}
              title="Panel de Vibra"
              footer={
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="ghost" size="sm" onClick={c}>
                    Cancelar
                  </Button>
                  <Button variant="brand" size="sm" onClick={c}>
                    Guardar
                  </Button>
                </div>
              }
            >
              <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                Hoja inferior en móvil, panel centrado en escritorio. Es el modal canónico.
              </p>
            </VibraResponsivePanel>
          ),
          ubicacion: "El modal canónico de toda la plataforma",
          archivo: "components/ui/VibraResponsivePanel.tsx",
          hace: "Aporta el botón de cerrar de la cabecera. Se expone también como «Modal» en components/ui.",
        },
        {
          id: "reporte",
          abrir: "Abrir reporte",
          overlay: (c) => (
            <ReportModal
              target={{ targetType: "post", targetId: "demo-post", targetOwnerId: "demo-autor" }}
              onClose={c}
            />
          ),
          ubicacion: "Menú de tres puntos de posts, perfiles y comentarios",
          archivo: "app/components/ReportModal/ReportModal.tsx",
          hace: "Elegir motivo, confirmar y cerrar. Cuatro botones repartidos en tres pasos.",
          aviso: "Enviar crea un reporte real",
        },
        {
          id: "recorte",
          abrir: "Abrir recorte",
          overlay: (c) => (
            <ImageCropperModal
              open
              title="Recortar la foto"
              hint="Arrastra para encuadrar"
              imageSrc={IMAGEN_DEMO}
              aspect={1}
              cropShape="round"
              onClose={c}
              onConfirm={c}
            />
          ),
          ubicacion: "Cambiar foto de perfil o portada",
          archivo: "components/media/ImageCropperModal.tsx",
          hace: "Recorta la imagen y devuelve el blob. Cancelar y confirmar.",
        },
        {
          id: "donacion-viewer",
          abrir: "Abrir donación",
          overlay: (c) => (
            <DonationViewer
              open
              donation={{
                mode: "general",
                currency: SETTLEMENT_CURRENCY,
                suggestedAmounts: [50, 100, 250],
                goalLabel: "Para el próximo video",
              }}
              profileName="Ana Creadora"
              profileHandle="ana"
              onClose={c}
              onDonate={c}
            />
          ),
          ubicacion: "Al tocar el botón de donación de un perfil",
          archivo: "app/[locale]/(protected)/u/[handle]/components/DonationViewer.tsx",
          hace: "Panel de contribución con los montos sugeridos, donar y cerrar.",
        },
        {
          id: "legal",
          abrir: "Abrir documento",
          overlay: (c) => <LegalDocPanel docId="terms" onClose={c} />,
          ubicacion: "Enlaces legales del pie",
          archivo: "components/legal/LegalDocPanel.tsx",
          hace: "Abre los términos o el aviso de privacidad, con su botón de cerrar.",
        },
        {
          id: "buscar-portada",
          boton: (
            <CajaPortada>
              <CoverSearchBar onSubmit={noop} onClose={noop} placeholder="Buscar portada…" />
            </CajaPortada>
          ),
          ubicacion: "Buscador de imágenes de portada",
          archivo: "app/components/CoverSearch/CoverSearchBar.tsx",
          hace: "Buscar y cerrar. Se posiciona en absoluto, así que la caja morada es su contenedor.",
        },
      ],
    },

    /* ─────────────────────────────── 6 ─────────────────────────────── */
    {
      titulo: "Perfil y comunidad",
      intro: "Los botones de identidad y de relación entre personas.",
      filas: [
        {
          id: "follow",
          boton: <FollowStateButton viewerUid={null} targetUid="demo-target" />,
          ubicacion: "Listas de miembros, seguidores y recomendaciones",
          archivo: "components/profile/FollowStateButton.tsx",
          hace: "Los cuatro estados del producto, Seguir · Siguiendo · Te sigue · Ambos se siguen. Aquí sale sin sesión, así que muestra el estado inicial y no escribe nada.",
        },
        {
          id: "edit-text",
          boton: <EditTextButton onClick={noop}>Editar</EditTextButton>,
          ubicacion: "Debajo del avatar, en el perfil y en la comunidad",
          archivo: "components/ui/EditTextButton.tsx",
          hace: "Abre el editor de foto, portada o historia. Sustituyó a los lápices flotantes que tapaban la imagen.",
        },
        {
          id: "story-circle",
          boton: <StoryCircle type="saludo" thumbnailUrl={IMAGEN_DEMO} onClick={noop} sublabel="Ana" />,
          ubicacion: "Carrusel de historias",
          archivo: "app/components/Stories/StoryCircle.tsx",
          hace: "Abre la historia. El aro cambia según sea saludo o consejo.",
        },
        /* Aquí había una ficha de `AddStoryCircle`, el círculo de "añadir" del
           carrusel. El carrusel dejó de usarlo y el componente se retiró. */
        {
          id: "buscar-grupos",
          boton: (
            <CajaAncha alto={70}>
              <GroupsSearchToolbar
                search={busqueda}
                onSearchChange={setBusqueda}
                onCreateGroup={noop}
                onCloseSearch={noop}
                fontStack="inherit"
                showCreateGroup
                showCloseSearch
                placeholder="Buscar comunidades…"
              />
            </CajaAncha>
          ),
          ubicacion: "Cabecera del buscador de comunidades",
          archivo: "app/components/SearchToolbar/GroupsSearchToolbar.tsx",
          hace: "Crear comunidad, cerrar el buscador y limpiar el texto.",
        },
      ],
    },

    /* ─────────────────────────────── 7 ─────────────────────────────── */
    {
      titulo: "Monetización y cierre de compra",
      intro: "Entrada a las donaciones y las pantallas de después de pagar.",
      filas: [
        /* Aquí había dos fichas de `DonationAccessButton`, la entrada a las
           donaciones de Mercado Pago. Se retiró con el resto de ese flujo, cuyo
           callable de backend ya no existía. */
        {
          id: "pago-ok",
          boton: (
            <CajaAncha alto={130}>
              <PaymentSuccessCard
                providerName="Ana Creadora"
                productType="Saludo personalizado"
                successMessage="Tu saludo está en camino."
                onClose={noop}
              />
            </CajaAncha>
          ),
          ubicacion: "Al volver de pagar",
          archivo: "components/payments/PaymentSuccessCard.tsx",
          hace: "Confirma la compra y cierra. Es la última pantalla del flujo de pago.",
        },
        {
          id: "servicio-ok",
          boton: (
            <CajaAncha alto={120}>
              <ServicePublishedSuccess
                message="Tu servicio ya está publicado."
                shareUrl="https://vibraon.com/es/u/ana"
                copyLabel="Copiar enlace"
                copiedLabel="¡Copiado!"
              />
            </CajaAncha>
          ),
          ubicacion: "Al publicar un servicio nuevo",
          archivo: "components/services/ServicePublishedSuccess.tsx",
          hace: "Copia el enlace del servicio recién publicado para compartirlo.",
        },
        {
          id: "wallet-preview",
          boton: (
            <CajaAncha alto={180}>
              <WalletPhonePreview />
            </CajaAncha>
          ),
          ubicacion: "Landing, sección de la wallet",
          archivo: "app/[locale]/(protected)/wallet/components/WalletPhonePreview.tsx",
          hace: "Maqueta de teléfono con la wallet dentro. Sus tres botones son de demostración.",
        },
      ],
    },

    /* ─────────────────────────────── 8 ─────────────────────────────── */
    {
      titulo: "Público y legal",
      intro: "Lo que ve quien todavía no tiene cuenta.",
      filas: [
        {
          id: "login-faq",
          boton: (
            <CajaAncha alto={140}>
              <LoginFaq />
            </CajaAncha>
          ),
          ubicacion: "Landing de entrada",
          archivo: "app/[locale]/(public)/login/LoginFaq.tsx",
          hace: "Despliega cada pregunta frecuente.",
        },
        {
          id: "login-cards",
          boton: (
            <CajaAncha alto={160}>
              <LoginCommunityCards />
            </CajaAncha>
          ),
          ubicacion: "Landing de entrada",
          archivo: "app/[locale]/(public)/login/LoginCommunityCards.tsx",
          hace: "Tarjetas de comunidades de ejemplo, con su llamada a crear una.",
        },
        {
          id: "legal-footer",
          boton: (
            <CajaAncha alto={90}>
              <LegalLinksFooter />
            </CajaAncha>
          ),
          ubicacion: "Pie de toda la plataforma",
          archivo: "components/legal/LegalLinksFooter.tsx",
          hace: "Abre términos, privacidad y demás documentos legales.",
        },
        {
          id: "stats-row",
          boton: (
            <CajaAncha alto={90}>
              <StatsRow
                items={[
                  { key: "posts", top: "128", bottom: "Publicaciones" },
                  { key: "followers", top: "2.4K", bottom: "Seguidores" },
                  { key: "groups", top: "7", bottom: "Comunidades" },
                ]}
              />
            </CajaAncha>
          ),
          ubicacion: "Cabecera del perfil",
          archivo: "components/ui/StatsRow.tsx",
          hace: "Cada cifra es pulsable y lleva a su lista.",
        },
      ],
    },

    /* ─────────────────────────────── 9 ─────────────────────────────── */
    {
      titulo: "Sesión y preferencias",
      intro:
        "Viven en la cabecera, el sidebar y los ajustes. Estos actúan de verdad al pulsarlos.",
      filas: [
        {
          id: "idioma",
          boton: <LanguageSwitcher variant="desktop" />,
          ubicacion: "Cabecera de escritorio",
          archivo: "app/components/LanguageSwitcher.tsx — variant desktop",
          hace: "Abre la lista de los 47 idiomas y navega a la misma ruta en el idioma elegido.",
          aviso: "Cambia el idioma de verdad",
        },
        {
          id: "idioma-ajustes",
          boton: <LanguageSwitcher variant="settings" />,
          ubicacion: "Configuración del menú del creador (celular)",
          archivo: "app/components/LanguageSwitcher.tsx — variant settings",
          hace: "Solo el \"Ver\" morado de la fila; abre la misma lista de idiomas. La etiqueta y el idioma actual los pinta la fila que lo envuelve.",
          aviso: "Cambia el idioma de verdad",
        },
        {
          id: "moneda",
          boton: <CurrencySwitcher variant="desktop" />,
          ubicacion: "Cabecera y wallet",
          archivo: "app/components/CurrencySwitcher.tsx — variant desktop",
          hace: "Abre la lista de monedas y fija la que se usa para mostrar todos los precios.",
          aviso: "Cambia la moneda de verdad",
        },
        {
          id: "moneda-ajustes",
          boton: <CurrencySwitcher variant="settings" />,
          ubicacion: "Configuración del menú del creador (celular)",
          archivo: "app/components/CurrencySwitcher.tsx — variant settings",
          hace: "Solo el \"Ver\" morado de la fila; abre la misma lista de monedas.",
          aviso: "Cambia la moneda de verdad",
        },
        {
          id: "logout-settings",
          boton: <LogoutButton variant="settings" />,
          ubicacion: "Ajustes del sidebar del creador",
          archivo: "app/LogoutButton.tsx — variant settings",
          hace: "Cierra la sesión de Firebase, limpia la sesión del servidor y navega fuera.",
          aviso: "Te cierra la sesión",
        },
        {
          id: "logout-icon",
          boton: <LogoutButton variant="icon" />,
          ubicacion: "Menú de la cuenta",
          archivo: "app/LogoutButton.tsx — variant icon",
          hace: "Lo mismo, reducido a icono.",
          aviso: "Te cierra la sesión",
        },
        {
          id: "logout-header",
          boton: <LogoutButton variant="headerIcon" />,
          ubicacion: "Cabecera",
          archivo: "app/LogoutButton.tsx — variant headerIcon",
          hace: "Lo mismo, con las medidas de la cabecera.",
          aviso: "Te cierra la sesión",
        },
      ],
    },
  ];

  const filaAbierta = bloques.flatMap((b) => b.filas).find((f) => f.id === abierto);
  let n = 0;

  return (
    <div style={{ minHeight: "100dvh", background: "#0b0b0d", color: "#eeecf2" }}>
      <style>{`
        .sim-wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 96px; }
        .sim-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4ade80; }
        .sim-h1 { margin: 4px 0 0; font-size: 26px; font-weight: 680; line-height: 1.15; }
        .sim-lead { margin: 8px 0 0; font-size: 13.5px; color: rgba(255,255,255,0.58); max-width: 700px; line-height: 1.55; }
        .sim-lead b { color: rgba(255,255,255,0.85); font-weight: 650; }
        .sim-nota { margin: 18px 0 0; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(251,191,36,0.24); background: rgba(251,191,36,0.06); font-size: 12.5px; line-height: 1.55; color: rgba(251,191,36,0.92); }
        .sim-sec { margin-top: 40px; }
        .sim-sec-t { margin: 0; font-size: 16px; font-weight: 650; }
        .sim-sec-i { margin: 5px 0 12px; font-size: 12.5px; color: rgba(255,255,255,0.5); line-height: 1.55; max-width: 740px; }
        .sim-tw { overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; background: rgba(255,255,255,0.02); }
        table.sim { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 820px; }
        table.sim th { text-align: start; font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: rgba(255,255,255,0.42); padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
        table.sim td { padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.055); vertical-align: middle; }
        table.sim tr:last-child td { border-bottom: none; }
        .sim-n { width: 1%; color: rgba(255,255,255,0.34); font-variant-numeric: tabular-nums; font-size: 12px; }
        .sim-b { width: 1%; }
        .sim-u { color: rgba(255,255,255,0.88); min-width: 200px; }
        .sim-f { display: block; margin-top: 3px; font-size: 10.5px; color: rgba(255,255,255,0.36); font-family: ui-monospace, "SF Mono", monospace; word-break: break-word; }
        .sim-h { color: rgba(255,255,255,0.62); line-height: 1.5; max-width: 40ch; }
        .sim-av { display: inline-block; margin-top: 6px; font-size: 10px; font-weight: 700; border-radius: 999px; padding: 3px 9px; background: rgba(239,68,68,0.14); color: #fca5a5; white-space: nowrap; }
        .sim-abrir { border: 1px dashed rgba(168,85,247,0.5); background: rgba(168,85,247,0.08); color: #d8b4fe; border-radius: 10px; padding: 8px 14px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .sim-abrir:hover { background: rgba(168,85,247,0.16); }
        .sim-abrir:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }
      `}</style>

      <div className="sim-wrap">
        <header>
          <span className="sim-tag">Catálogo interno</span>
          <h1 className="sim-h1">Simulador de botones</h1>
          <p className="sim-lead">
            Cada celda monta el <b>componente real</b>, importado de su archivo. No hay copias
            redibujadas: si el componente cambia, esta tabla cambia con él. Los que se dibujan a
            pantalla completa llevan un disparador y se abren encima.
          </p>
          <p className="sim-nota">
            No están los 604 botones que necesitan un usuario autenticado para montarse, ni las
            páginas completas de admin, que no son componentes y no caben en una fila.
          </p>
        </header>

        {bloques.map((bloque) => (
          <section className="sim-sec" key={bloque.titulo}>
            <h2 className="sim-sec-t">{bloque.titulo}</h2>
            <p className="sim-sec-i">{bloque.intro}</p>
            <div className="sim-tw">
              <table className="sim">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Botón real</th>
                    <th>Dónde está</th>
                    <th>Qué hace</th>
                  </tr>
                </thead>
                <tbody>
                  {bloque.filas.map((fila) => {
                    n += 1;
                    return (
                      <tr key={fila.id}>
                        <td className="sim-n">{n}</td>
                        <td className="sim-b">
                          {fila.overlay ? (
                            <button
                              type="button"
                              className="sim-abrir"
                              onClick={() => setAbierto(fila.id)}
                            >
                              {fila.abrir ?? "Abrir"}
                            </button>
                          ) : (
                            fila.boton
                          )}
                        </td>
                        <td className="sim-u">
                          {fila.ubicacion}
                          <code className="sim-f">{fila.archivo}</code>
                        </td>
                        <td className="sim-h">
                          {fila.hace}
                          {fila.aviso ? <span className="sim-av">{fila.aviso}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {filaAbierta?.overlay ? filaAbierta.overlay(cerrar) : null}
    </div>
  );
}
