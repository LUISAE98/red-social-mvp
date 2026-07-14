"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * Vista previa de las características de un servicio, mostrada en la tarjeta del
 * creador cuando el servicio está INACTIVO (perfil → experiencias). Reutiliza los
 * mismos íconos que el panel de compra, pero con las descripciones redactadas
 * hacia el CREADOR ("tu seguidor…", "tú propondrás…") en vez de hacia el comprador.
 */

type ServiceKey = "saludo" | "consejo" | "meetGreet" | "customClass";

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
      <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
        <span style={titleTextStyle}>{title}</span>
        <span style={descTextStyle}>{description}</span>
      </div>
    </div>
  );
}

export default function ServiceFeaturePreview({
  service,
  accentColor,
}: {
  service: ServiceKey;
  accentColor: string;
}) {
  const t = useTranslations("services");

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
        <FeatureCell icon="clock" color={accentColor} title={t("duration")} description={t("featurePreviewDurationDesc")} />
        <FeatureCell icon="camera" color={accentColor} title={t("modalityLabel")} description={t("fromAnywhereDesc")} />
        {IncludesCell}
        <FeatureCell icon="calendar" color={accentColor} title={t("scheduleDateTimeLabel")} description={t("featurePreviewScheduleDesc")} />
      </>
    );
  } else {
    // customClass (sesión exclusiva)
    cells = (
      <>
        <FeatureCell icon="clock" color={accentColor} title={t("duration")} description={t("featurePreviewDurationDesc")} />
        <FeatureCell icon="camera" color={accentColor} title={t("modalityLabel")} description={t("fromAnywhereDesc")} />
        <FeatureCell icon="focus" color={accentColor} title={t("exclusiveSessionFocusedLabel")} description={t("featurePreviewFocusedDesc")} />
        <FeatureCell icon="lock" color={accentColor} title={t("exclusiveSessionPrivateLabel")} description={t("exclusiveSessionPrivateDesc")} />
        {IncludesCell}
        <FeatureCell icon="calendar" color={accentColor} title={t("scheduleDateTimeLabel")} description={t("featurePreviewScheduleDesc")} />
      </>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>{cells}</div>
  );
}
