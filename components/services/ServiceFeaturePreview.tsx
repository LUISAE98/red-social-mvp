"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * Vista previa de las características de un servicio, mostrada en la tarjeta del
 * creador cuando el servicio está INACTIVO (perfil → experiencias). Reutiliza los
 * mismos íconos que el panel de compra, pero con las descripciones redactadas
 * hacia el CREADOR ("tu seguidor…", "tú propondrás…") en vez de hacia el comprador.
 */

type ServiceKey =
  | "saludo"
  | "consejo"
  | "meetGreet"
  | "customClass"
  | "liveAccess"
  | "subscription"
  | "superComments";

function IconWrap({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, (color: string) => React.ReactNode> = {
  check: (c) => (
    <IconWrap color={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-5.5" />
    </IconWrap>
  ),
  download: (c) => (
    <IconWrap color={c}>
      <path d="M12 3v12M7 11l5 5 5-5" />
      <path d="M4 19h16" />
    </IconWrap>
  ),
  clock: (c) => (
    <IconWrap color={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </IconWrap>
  ),
  camera: (c) => (
    <IconWrap color={c}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3V10Z" />
    </IconWrap>
  ),
  focus: (c) => (
    <IconWrap color={c}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill={c} />
    </IconWrap>
  ),
  lock: (c) => (
    <IconWrap color={c}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1" fill={c} />
    </IconWrap>
  ),
  calendar: (c) => (
    <IconWrap color={c}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </IconWrap>
  ),
  includes: (c) => (
    <IconWrap color={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-5" />
    </IconWrap>
  ),
  star: (c) => (
    <IconWrap color={c}>
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5Z" />
    </IconWrap>
  ),
  heart: (c) => (
    <IconWrap color={c}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z" />
    </IconWrap>
  ),
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 10,
  padding: "2px 0",
};
const titleTextStyle: React.CSSProperties = { color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 };
const descTextStyle: React.CSSProperties = { color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 };

function FeatureCell({
  icon,
  title,
  description,
  color,
}: {
  icon: string;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div style={rowStyle}>
      {ICONS[icon](color)}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={titleTextStyle}>{title}</span>
        <span style={descTextStyle}>{description}</span>
      </div>
    </div>
  );
}

export default function ServiceFeaturePreview({
  service,
  accentColor,
  durationDescription,
}: {
  service: ServiceKey;
  accentColor: string;
  /**
   * Texto del item "Duración" (solo aplica a meetGreet y customClass). Si se
   * omite, se usa la descripción genérica. El wallet onboarding lo usa para
   * mostrar el rango de minutos; el perfil lo deja vacío a propósito, porque
   * ahí el creador configura su propia duración.
   */
  durationDescription?: string;
}) {
  const t = useTranslations("services");
  const durationDesc = durationDescription ?? t("featurePreviewDurationDesc");

  const includesItems = [
    t("defaultIncludeConversation"),
    t("featurePreviewIncludeDQ"),
    t("defaultIncludeIdeas"),
    t("featurePreviewIncludeAttention"),
  ];

  const IncludesCell = (
    <div style={rowStyle}>
      {ICONS.includes(accentColor)}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={titleTextStyle}>{t("whatIncludesLabel")}</span>
        {includesItems.map((item) => (
          <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
            <svg
              width={11}
              height={11}
              viewBox="0 0 24 24"
              fill="none"
              stroke={accentColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path d="M4 12.5l5 5 11-11" />
            </svg>
            <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, lineHeight: 1.4 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );

  let cells: React.ReactNode;

  if (service === "saludo" || service === "consejo") {
    cells = (
      <>
        <FeatureCell
          icon="check"
          color={accentColor}
          title={service === "consejo" ? t("greetBadgeConsejo") : t("greetBadgeSaludo")}
          description={service === "consejo" ? t("featurePreviewConsejoCheckDesc") : t("featurePreviewSaludoCheckDesc")}
        />
        <FeatureCell
          icon="download"
          color={accentColor}
          title={t("downloadableLabel")}
          description={service === "consejo" ? t("featurePreviewDownloadConsejoDesc") : t("featurePreviewDownloadSaludoDesc")}
        />
      </>
    );
  } else if (service === "meetGreet") {
    cells = (
      <>
        <FeatureCell icon="clock" color={accentColor} title={t("duration")} description={durationDesc} />
        <FeatureCell icon="camera" color={accentColor} title={t("modalityLabel")} description={t("fromAnywhereDesc")} />
        {IncludesCell}
        <FeatureCell icon="calendar" color={accentColor} title={t("scheduleDateTimeLabel")} description={t("featurePreviewScheduleDesc")} />
      </>
    );
  } else if (service === "customClass") {
    // sesión exclusiva
    cells = (
      <>
        <FeatureCell icon="clock" color={accentColor} title={t("duration")} description={durationDesc} />
        <FeatureCell icon="camera" color={accentColor} title={t("modalityLabel")} description={t("fromAnywhereDesc")} />
        <FeatureCell icon="focus" color={accentColor} title={t("exclusiveSessionFocusedLabel")} description={t("featurePreviewFocusedDesc")} />
        <FeatureCell icon="lock" color={accentColor} title={t("exclusiveSessionPrivateLabel")} description={t("exclusiveSessionPrivateDesc")} />
        {IncludesCell}
        <FeatureCell icon="calendar" color={accentColor} title={t("scheduleDateTimeLabel")} description={t("featurePreviewScheduleDesc")} />
      </>
    );
  } else if (service === "liveAccess") {
    // acceso a transmisiones en vivo
    cells = (
      <>
        <FeatureCell icon="lock" color={accentColor} title={t("liveAccessTicketLabel")} description={t("liveAccessTicketDesc")} />
        <FeatureCell icon="star" color={accentColor} title={t("liveAccessSuperLabel")} description={t("liveAccessSuperDesc")} />
        <FeatureCell icon="heart" color={accentColor} title={t("liveAccessDonationLabel")} description={t("liveAccessDonationDesc")} />
      </>
    );
  } else if (service === "subscription") {
    // suscripciones a tu comunidad
    cells = (
      <>
        <FeatureCell icon="calendar" color={accentColor} title={t("subscriptionPreviewRecurringLabel")} description={t("subscriptionPreviewRecurringDesc")} />
        <FeatureCell icon="star" color={accentColor} title={t("subscriptionPreviewExclusiveLabel")} description={t("subscriptionPreviewExclusiveDesc")} />
        <FeatureCell icon="heart" color={accentColor} title={t("subscriptionPreviewBenefitsLabel")} description={t("subscriptionPreviewBenefitsDesc")} />
        <FeatureCell icon="check" color={accentColor} title={t("subscriptionPreviewPriceLabel")} description={t("subscriptionPreviewPriceDesc")} />
      </>
    );
  } else {
    // superComments (supercomentarios)
    cells = (
      <>
        <FeatureCell icon="star" color={accentColor} title={t("superCommentsPreviewTiersLabel")} description={t("superCommentsPreviewTiersDesc")} />
        <FeatureCell icon="focus" color={accentColor} title={t("superCommentsPreviewPinLabel")} description={t("superCommentsPreviewPinDesc")} />
        <FeatureCell icon="camera" color={accentColor} title={t("superCommentsPreviewLiveLabel")} description={t("superCommentsPreviewLiveDesc")} />
        <FeatureCell icon="check" color={accentColor} title={t("superCommentsPreviewPriceLabel")} description={t("superCommentsPreviewPriceDesc")} />
      </>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>{cells}</div>
  );
}
