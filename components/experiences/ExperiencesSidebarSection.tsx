"use client";

/**
 * "Mis experiencias" dentro del menú lateral: una sección plegable con las
 * últimas experiencias y un enlace a /experiencias para ver el resto.
 *
 * NO dibuja tarjetas propias. Monta el MISMO `OwnerSidebarGreetings` que usa la
 * página, con `activeSection` fijado, así que lo que se ve aquí es literalmente
 * la tarjeta de entregados —o la de pendientes— de /experiencias, con su
 * portada, su estado y su detalle desplegable. Cualquier corrección a esas
 * tarjetas llega aquí sola.
 *
 * Lo único propio es el encabezado (`RailHeader`, el mismo de los rails de
 * arriba) y el recorte: la lista larga vive en la página.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import RailHeader from "@/components/groups/RailHeader";
import OwnerSidebarGreetings from "@/app/components/OwnerSidebar/OwnerSidebarGreetings";
import {
  buildDisplayName,
  fmtDate,
} from "@/app/components/OwnerSidebar/OwnerSidebar.utils";
import type {
  ExclusiveSessionRequestDoc,
  GreetingRequestDoc,
  GroupDocLite,
  MeetGreetRequestDoc,
  UserMini,
} from "@/app/components/OwnerSidebar/OwnerSidebar.parts";

import { greetingsCardStyles } from "./greetingsCardStyles";

export default function ExperiencesSidebarSection({
  title,
  icon,
  badgeCount = 0,
  seeAllLabel,
  onSeeAll,
  activeSection,
  buyerPending,
  buyerDelivered,
  buyerMeetGreets,
  buyerExclusiveSessions,
  groupMetaMap,
  userMiniMap,
  router,
}: {
  title: string;
  icon?: ReactNode;
  badgeCount?: number;
  seeAllLabel?: string;
  onSeeAll: () => void;
  /**
   * Qué bandeja enseña. Lo decide el padre: entregadas si hay alguna, y si no,
   * pendientes. Nunca las dos a la vez.
   */
  activeSection: "delivered" | "requested";
  /** Ya recortados por el padre a las últimas. Aquí no se filtra nada. */
  buyerPending: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerDelivered: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerMeetGreets: Array<{ id: string; data: MeetGreetRequestDoc }>;
  buyerExclusiveSessions: Array<{
    id: string;
    data: ExclusiveSessionRequestDoc;
  }>;
  groupMetaMap: Record<string, GroupDocLite>;
  userMiniMap: Record<string, UserMini>;
  router: { push: (href: string) => void };
}) {
  const tCommon = useTranslations("common");
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tSessions = useTranslations("sessions");
  const locale = useLocale();

  // Cerrada de entrada, igual que el resto de secciones del menú.
  const [open, setOpen] = useState(false);

  // Mismo mapa de nombres que la página: la tarjeta rotula el servicio con él.
  const typeLabel = (type: string) => {
    if (type === "saludo") return tWallet("typeLabelGreeting");
    if (type === "consejo") return tWallet("typeLabelAdvice");
    if (type === "meet_greet_digital") return tSessions("meetGreetTitle");
    if (
      type === "exclusive_session" ||
      type === "clase_personalizada" ||
      type === "digital_exclusive_session"
    ) {
      return tServices("exclusiveSession");
    }
    return type;
  };

  function renderUserLink(uid: string): ReactNode {
    const u = userMiniMap[uid];
    const label = u?.displayName ?? buildDisplayName(null, uid, tCommon("user"));
    const href = u?.handle ? `/u/${u.handle}` : null;

    if (!href) {
      return (
        <span
          style={{ color: "#fff", fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}
        >
          {label}
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          router.push(href);
        }}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 12,
          lineHeight: 1.2,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <RailHeader
        icon={icon}
        title={title}
        open={open}
        collapsible
        badgeCount={badgeCount}
        seeAllLabel={seeAllLabel}
        onToggle={() => setOpen((prev) => !prev)}
        onSeeAll={onSeeAll}
      />

      {/* 0fr→1fr anima hasta la altura real del contenido, sin tope fijo que lo
          recorte. Mismo plegado que los rails de arriba. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transition:
            "grid-template-rows 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease",
        }}
      >
        <div style={{ overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "0 6px 6px", minWidth: 0 }}>
            <OwnerSidebarGreetings
              activeSection={activeSection}
              buyerPending={buyerPending}
              buyerDelivered={buyerDelivered}
              // Rechazadas y devoluciones no se asoman al menú: son la tercera
              // bandeja de la página y aquí solo caben las últimas de una.
              buyerRejectedGreetings={[]}
              buyerMeetGreets={buyerMeetGreets}
              buyerExclusiveSessions={buyerExclusiveSessions}
              // Bandejas del CREADOR (lo que le piden a él). Este bloque es del
              // lado comprador.
              meetGreetsByGroup={{}}
              exclusiveSessionsByGroup={{}}
              groupMetaMap={groupMetaMap}
              userMiniMap={userMiniMap}
              styles={greetingsCardStyles}
              typeLabel={typeLabel}
              fmtDate={(ts) => fmtDate(ts, locale)}
              renderUserLink={renderUserLink}
              router={router}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
