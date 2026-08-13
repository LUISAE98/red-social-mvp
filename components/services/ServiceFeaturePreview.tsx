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
  | "superComments"
  | "liveDonation"
  | "profileDonation"
  | "vodUnlock"
  | "premiumPost";

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

// Claves cuya redacción está en voz de CREADOR ("tu seguidor…", "tú fijas…") y
// tienen una variante dirigida al fan (misma clave + "User"). El resolver las
// intercambia cuando audience === "user"; las claves neutrales (títulos como
// "Duración", "Descargable") no están aquí y se usan igual para ambos.
// Fuente de las variantes: messages/*.json → services.*User.
const SVC_USER_KEYS = new Set([
  "featurePreviewDurationDesc",
  "featurePreviewIncludeDQ",
  "featurePreviewIncludeAttention",
  "featurePreviewSaludoCheckDesc",
  "featurePreviewConsejoCheckDesc",
  "featurePreviewDownloadSaludoDesc",
  "featurePreviewDownloadConsejoDesc",
  "featurePreviewScheduleDesc",
  "featurePreviewFocusedDesc",
  "liveAccessTicketDesc",
  "liveAccessSuperDesc",
  "liveAccessDonationDesc",
  "subscriptionPreviewRecurringLabel",
  "subscriptionPreviewRecurringDesc",
  "subscriptionPreviewExclusiveDesc",
  "subscriptionPreviewBenefitsDesc",
  "subscriptionPreviewPriceLabel",
  "subscriptionPreviewPriceDesc",
  "superCommentsPreviewTiersLabel",
  "superCommentsPreviewTiersDesc",
  "superCommentsPreviewPinLabel",
  "superCommentsPreviewPinDesc",
  "superCommentsPreviewLiveLabel",
  "superCommentsPreviewLiveDesc",
  "superCommentsPreviewPriceLabel",
  "superCommentsPreviewPriceDesc",
  "liveDonationPreviewSupportDesc",
  "liveDonationPreviewShowLabel",
  "liveDonationPreviewShowDesc",
  "profileDonationPreviewAnytimeLabel",
  "profileDonationPreviewAnytimeDesc",
  "profileDonationPreviewMessageLabel",
  "profileDonationPreviewMessageDesc",
  "profileDonationPreviewVideoDesc",
  "profileDonationPreviewMinLabel",
  "profileDonationPreviewMinDesc",
  "vodUnlockPreviewOneTimeDesc",
  "vodUnlockPreviewLongDesc",
  "vodUnlockPreviewSubsLabel",
  "vodUnlockPreviewSubsDesc",
  "vodUnlockPreviewPriceLabel",
  "vodUnlockPreviewPriceDesc",
  "premiumPostPreviewUnlockDesc",
  "premiumPostPreviewFeedLabel",
  "premiumPostPreviewFeedDesc",
  "premiumPostPreviewSubsLabel",
  "premiumPostPreviewSubsDesc",
  "premiumPostPreviewPriceLabel",
  "premiumPostPreviewPriceDesc",
]);

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
  // Boleto con sus muescas laterales y la línea perforada. Dice "entrada de
  // pago" mucho antes que un candado, que solo dice "cerrado".
  ticket: (c) => (
    <IconWrap color={c}>
      <path d="M3 9.5V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a2.5 2.5 0 0 0 0-5Z" />
      <path d="M15 7.6v1.6M15 11.2v1.6M15 14.8v1.6" />
    </IconWrap>
  ),
  // Globo de comentario con una estrella dentro. La estrella sola se confunde
  // con "destacado" a secas; dentro del globo se lee "mensaje que destaca".
  // El grupo escala la estrella y sube su grosor para compensar la escala, si
  // no el trazo saldría más delgado que el del resto de los iconos.
  commentStar: (c) => (
    <IconWrap color={c}>
      <path d="M20 3H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 16h3v4.5L12.4 16H20a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 3Z" />
      <g transform="translate(12 9.4) scale(0.36) translate(-12 -12)" strokeWidth={5}>
        <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5Z" />
      </g>
    </IconWrap>
  ),
  // Persona con estrella: pertenecer, no un cobro que se repite. El calendario
  // decía "cada mes", que es la mecánica, no lo que se gana.
  memberBadge: (c) => (
    <IconWrap color={c}>
      <circle cx="10" cy="7.8" r="3.6" />
      <path d="M3.2 20.4c0-3.5 3-6.2 6.8-6.2 1.1 0 2.2.2 3.1.7" />
      <g transform="translate(17.8 16.6) scale(0.42) translate(-12 -12)" strokeWidth={4.3}>
        <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5Z" />
      </g>
    </IconWrap>
  ),
  // Publicación con candado ABIERTO —el arco no baja del otro lado—, que es lo
  // que separa "desbloqueaste esto" de "esto está cerrado".
  postUnlocked: (c) => (
    <IconWrap color={c}>
      <rect x="2.5" y="3.5" width="12.5" height="11.5" rx="2" />
      <path d="M5.6 7.3h6.3M5.6 10.2h4.2" />
      <rect x="15.5" y="15.5" width="6" height="5" rx="1.3" />
      <path d="M17 15.5v-1.6a1.75 1.75 0 0 1 3.45-.4" />
    </IconWrap>
  ),
  // Marco de publicación con estrella. Sin cámara a propósito: un post premium
  // también puede ser foto, texto o galería.
  postStar: (c) => (
    <IconWrap color={c}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 8.5h18" />
      <g transform="translate(12 14.3) scale(0.44) translate(-12 -12)" strokeWidth={4.1}>
        <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5Z" />
      </g>
    </IconWrap>
  ),
  // Mano abierta sosteniendo un corazón. El corazón solo dice "me gusta"; con
  // la mano debajo se lee como dar algo.
  handHeart: (c) => (
    <IconWrap color={c}>
      <path d="M12 12.4 8.6 9.2a2.3 2.3 0 1 1 3.4-3.05 2.3 2.3 0 1 1 3.4 3.05L12 12.4Z" />
      <path d="M5 14.6c.6 3.4 3.5 5.6 7 5.6s6.4-2.2 7-5.6" />
    </IconWrap>
  ),
  // Ondas de transmisión con el corazón en medio: la donación que ocurre
  // mientras el live está al aire, distinta de la del perfil.
  liveHeart: (c) => (
    <IconWrap color={c}>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <path d="M16.2 7.7c2.3 2.4 2.3 6.2 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
      <path d="M12 14.6 9.5 12.2a1.75 1.75 0 1 1 2.5-2.3 1.75 1.75 0 1 1 2.5 2.3L12 14.6Z" />
    </IconWrap>
  ),
  // Reproductor con un candado de insignia: video grabado + acceso de pago.
  videoLock: (c) => (
    <IconWrap color={c}>
      <rect x="2" y="4" width="13.5" height="10.5" rx="2" />
      <path d="M7.2 6.6l4.4 2.65-4.4 2.65V6.6Z" />
      <rect x="16.5" y="15" width="5.5" height="4.5" rx="1.2" />
      <path d="M18 15v-1.2a1.3 1.3 0 0 1 2.6 0V15" />
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
  descColor,
}: {
  icon: string;
  title: string;
  description: string;
  color: string;
  descColor?: string;
}) {
  return (
    <div style={rowStyle}>
      {ICONS[icon](color)}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={titleTextStyle}>{title}</span>
        <span style={descColor ? { ...descTextStyle, color: descColor } : descTextStyle}>
          {description}
        </span>
      </div>
    </div>
  );
}

export default function ServiceFeaturePreview({
  service,
  accentColor,
  durationDescription,
  audience = "creator",
  firstCell,
  cells: cellsOverride,
  columns = 2,
  descColor,
  omitIcons,
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
  /**
   * A quién se dirige el copy. "creator" (default) mantiene la redacción hacia el
   * creador (paneles de admin, tarjetas del perfil). "user" redirige las claves
   * con voz de creador a su variante de fan (onboarding de usuario en el login).
   */
  audience?: "creator" | "user";
  /**
   * Reemplaza la PRIMERA celda de la vista previa por una personalizada (icono,
   * color y textos por clave del namespace `services`). Lo usa el onboarding de
   * usuario para poner la donación (corazón morado) al inicio de supercomentarios.
   * Solo tiene efecto en el servicio `superComments`.
   */
  firstCell?: { icon: string; color: string; titleKey: string; descKey: string };
  /**
   * Sustituye por completo los items del servicio por unos propios (texto ya
   * resuelto, no claves). Lo usa el login, donde una sola card cubre VARIAS
   * experiencias —saludos y consejos, por ejemplo— y los textos por servicio se
   * quedan cortos: hablan solo de una. El resto de la app no lo pasa y sigue
   * viendo los items de siempre.
   */
  cells?: readonly { icon: string; title: string; description: string }[];
  /**
   * Columnas del mosaico de items. 2 por defecto (tarjetas del creador y
   * wallet, donde el ancho manda). El login usa 1 para apilarlos: ahí cada card
   * es angosta y en dos columnas los textos quedaban ilegibles.
   */
  columns?: 1 | 2;
  /**
   * Color de la descripción de cada item. Por defecto va tenue (42% de blanco),
   * que funciona dentro de los paneles del creador. El login lo sube: ahí los
   * items son parte de la presentación, sobre negro puro, y a ese gris casi no
   * se le ve.
   */
  descColor?: string;
  /**
   * Quita items del servicio por su icono (`clock`, `camera`, `calendar`…).
   * Existe para poder mostrar la lista del servicio MENOS alguno sin tener que
   * reescribirla entera con `cells`, que perdería las traducciones de los que
   * sí se quedan. El login la usa para esconder la duración de los encuentros,
   * que ahí no dice nada porque cada creador fija la suya.
   */
  omitIcons?: readonly string[];
}) {
  const rawT = useTranslations("services");
  // Intercambia por la variante de usuario ("<clave>User") cuando aplica.
  const t = (key: string, values?: Parameters<typeof rawT>[1]) =>
    rawT(audience === "user" && SVC_USER_KEYS.has(key) ? `${key}User` : key, values);
  const durationDesc = durationDescription ?? t("featurePreviewDurationDesc");

  const includesItems = [
    t("defaultIncludeConversation"),
    t("featurePreviewIncludeDQ"),
    t("defaultIncludeIdeas"),
    t("featurePreviewIncludeAttention"),
  ];

  const IncludesCell = (
    // `data-cell` lo hace filtrable por `omitIcons` como al resto: esta fila se
    // arma aparte (lleva su propia lista adentro) y no pasa por FeatureCell,
    // así que no tiene prop `icon` con la cual identificarla.
    <div data-cell="includes" style={rowStyle}>
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

  if (cellsOverride) {
    cells = (
      <>
        {cellsOverride.map((c) => (
          <FeatureCell descColor={descColor}
            key={c.title}
            icon={c.icon}
            color={accentColor}
            title={c.title}
            description={c.description}
          />
        ))}
      </>
    );
  } else if (service === "saludo" || service === "consejo") {
    cells = (
      <>
        <FeatureCell descColor={descColor}
          icon="check"
          color={accentColor}
          title={service === "consejo" ? t("greetBadgeConsejo") : t("greetBadgeSaludo")}
          description={service === "consejo" ? t("featurePreviewConsejoCheckDesc") : t("featurePreviewSaludoCheckDesc")}
        />
        <FeatureCell descColor={descColor}
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
        <FeatureCell descColor={descColor} icon="clock" color={accentColor} title={t("duration")} description={durationDesc} />
        <FeatureCell descColor={descColor} icon="camera" color={accentColor} title={t("modalityLabel")} description={t("fromAnywhereDesc")} />
        {IncludesCell}
        <FeatureCell descColor={descColor} icon="calendar" color={accentColor} title={t("scheduleDateTimeLabel")} description={t("featurePreviewScheduleDesc")} />
      </>
    );
  } else if (service === "customClass") {
    // sesión exclusiva
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="clock" color={accentColor} title={t("duration")} description={durationDesc} />
        <FeatureCell descColor={descColor} icon="camera" color={accentColor} title={t("modalityLabel")} description={t("fromAnywhereDesc")} />
        <FeatureCell descColor={descColor} icon="focus" color={accentColor} title={t("exclusiveSessionFocusedLabel")} description={t("featurePreviewFocusedDesc")} />
        <FeatureCell descColor={descColor} icon="lock" color={accentColor} title={t("exclusiveSessionPrivateLabel")} description={t("exclusiveSessionPrivateDesc")} />
        {IncludesCell}
        <FeatureCell descColor={descColor} icon="calendar" color={accentColor} title={t("scheduleDateTimeLabel")} description={t("featurePreviewScheduleDesc")} />
      </>
    );
  } else if (service === "liveAccess") {
    // acceso a transmisiones en vivo
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="lock" color={accentColor} title={t("liveAccessTicketLabel")} description={t("liveAccessTicketDesc")} />
        <FeatureCell descColor={descColor} icon="star" color={accentColor} title={t("liveAccessSuperLabel")} description={t("liveAccessSuperDesc")} />
        <FeatureCell descColor={descColor} icon="heart" color={accentColor} title={t("liveAccessDonationLabel")} description={t("liveAccessDonationDesc")} />
      </>
    );
  } else if (service === "subscription") {
    // suscripciones a tu comunidad
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="calendar" color={accentColor} title={t("subscriptionPreviewRecurringLabel")} description={t("subscriptionPreviewRecurringDesc")} />
        <FeatureCell descColor={descColor} icon="star" color={accentColor} title={t("subscriptionPreviewExclusiveLabel")} description={t("subscriptionPreviewExclusiveDesc")} />
        <FeatureCell descColor={descColor} icon="heart" color={accentColor} title={t("subscriptionPreviewBenefitsLabel")} description={t("subscriptionPreviewBenefitsDesc")} />
        <FeatureCell descColor={descColor} icon="check" color={accentColor} title={t("subscriptionPreviewPriceLabel")} description={t("subscriptionPreviewPriceDesc")} />
      </>
    );
  } else if (service === "superComments") {
    // supercomentarios
    cells = (
      <>
        {firstCell ? (
          <FeatureCell descColor={descColor}
            icon={firstCell.icon}
            color={firstCell.color}
            title={t(firstCell.titleKey)}
            description={t(firstCell.descKey)}
          />
        ) : (
          <FeatureCell descColor={descColor} icon="star" color={accentColor} title={t("superCommentsPreviewTiersLabel")} description={t("superCommentsPreviewTiersDesc")} />
        )}
        <FeatureCell descColor={descColor} icon="focus" color={accentColor} title={t("superCommentsPreviewPinLabel")} description={t("superCommentsPreviewPinDesc")} />
        <FeatureCell descColor={descColor} icon="camera" color={accentColor} title={t("superCommentsPreviewLiveLabel")} description={t("superCommentsPreviewLiveDesc")} />
        <FeatureCell descColor={descColor} icon="check" color={accentColor} title={t("superCommentsPreviewPriceLabel")} description={t("superCommentsPreviewPriceDesc")} />
      </>
    );
  } else if (service === "liveDonation") {
    // donaciones en vivo
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="heart" color={accentColor} title={t("liveDonationPreviewSupportLabel")} description={t("liveDonationPreviewSupportDesc")} />
        <FeatureCell descColor={descColor} icon="focus" color={accentColor} title={t("liveDonationPreviewShowLabel")} description={t("liveDonationPreviewShowDesc")} />
        <FeatureCell descColor={descColor} icon="includes" color={accentColor} title={t("liveDonationPreviewAnyoneLabel")} description={t("liveDonationPreviewAnyoneDesc")} />
      </>
    );
  } else if (service === "profileDonation") {
    // donaciones en tu perfil
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="heart" color={accentColor} title={t("profileDonationPreviewAnytimeLabel")} description={t("profileDonationPreviewAnytimeDesc")} />
        <FeatureCell descColor={descColor} icon="star" color={accentColor} title={t("profileDonationPreviewMessageLabel")} description={t("profileDonationPreviewMessageDesc")} />
        <FeatureCell descColor={descColor} icon="camera" color={accentColor} title={t("profileDonationPreviewVideoLabel")} description={t("profileDonationPreviewVideoDesc")} />
        <FeatureCell descColor={descColor} icon="check" color={accentColor} title={t("profileDonationPreviewMinLabel")} description={t("profileDonationPreviewMinDesc")} />
      </>
    );
  } else if (service === "vodUnlock") {
    // acceso a videos exclusivos
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="lock" color={accentColor} title={t("vodUnlockPreviewOneTimeLabel")} description={t("vodUnlockPreviewOneTimeDesc")} />
        <FeatureCell descColor={descColor} icon="camera" color={accentColor} title={t("vodUnlockPreviewLongLabel")} description={t("vodUnlockPreviewLongDesc")} />
        <FeatureCell descColor={descColor} icon="star" color={accentColor} title={t("vodUnlockPreviewSubsLabel")} description={t("vodUnlockPreviewSubsDesc")} />
        <FeatureCell descColor={descColor} icon="check" color={accentColor} title={t("vodUnlockPreviewPriceLabel")} description={t("vodUnlockPreviewPriceDesc")} />
      </>
    );
  } else {
    // premiumPost (publicaciones premium)
    cells = (
      <>
        <FeatureCell descColor={descColor} icon="lock" color={accentColor} title={t("premiumPostPreviewUnlockLabel")} description={t("premiumPostPreviewUnlockDesc")} />
        <FeatureCell descColor={descColor} icon="camera" color={accentColor} title={t("premiumPostPreviewFeedLabel")} description={t("premiumPostPreviewFeedDesc")} />
        <FeatureCell descColor={descColor} icon="star" color={accentColor} title={t("premiumPostPreviewSubsLabel")} description={t("premiumPostPreviewSubsDesc")} />
        <FeatureCell descColor={descColor} icon="check" color={accentColor} title={t("premiumPostPreviewPriceLabel")} description={t("premiumPostPreviewPriceDesc")} />
      </>
    );
  }

  // Se filtra sobre los elementos ya construidos, leyendo su prop `icon`. Así
  // `omitIcons` no obliga a tocar las ~38 celdas de este archivo, y los items
  // sin icono propio (el de "Incluye", que arma su fila aparte) nunca se caen.
  const visibleCells =
    omitIcons && omitIcons.length > 0
      ? React.Children.toArray(
          (cells as React.ReactElement<{ children?: React.ReactNode }>).props.children,
        ).filter((child) => {
          if (!React.isValidElement<{ icon?: string; "data-cell"?: string }>(child)) return true;
          const id = child.props.icon ?? child.props["data-cell"];
          return id === undefined || !omitIcons.includes(id);
        })
      : cells;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns === 1 ? "1fr" : "1fr 1fr",
        gap: columns === 1 ? 12 : 8,
        marginTop: 10,
      }}
    >
      {visibleCells}
    </div>
  );
}
