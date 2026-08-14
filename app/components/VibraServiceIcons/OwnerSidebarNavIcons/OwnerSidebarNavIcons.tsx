// Iconos del subnav del OwnerSidebar con gradiente Vibra (#ec4899 → #9333ea → #3b82f6)

type IconProps = {
  size?: number;
  strokeWidth?: number;
};

const BASE: React.CSSProperties = {
  display: "block",
  flexShrink: 0,
};

// Solid purple — url(#gradient) no resuelve confiablemente en Safari mobile
const g = "#a855f7";

// Perfiles seguidos — persona con checkmark de follow
export function SidebarFollowingIcon({ size = 18, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <circle cx="9.5" cy="8" r="3.2" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 20.5c.6-4 3.2-6 6-6" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 13.5V18.5M15.5 16H20.5" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Mis comunidades — escudo con checkmark (soy owner/admin)
export function SidebarMyCommunitiesIcon({ size = 18, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <path
        d="M12 3.5L20 7.5V12.5C20 16.8 16.4 20 12 21.5C7.6 20 4 16.8 4 12.5V7.5L12 3.5Z"
        fill="none"
        stroke={g}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Otras comunidades — globo terráqueo (comunidades externas/explorar)
export function SidebarOtherCommunitiesIcon({ size = 18, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <circle cx="12" cy="12" r="8.2" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.8 12H20.2" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path
        d="M12 3.8C9.9 6.1 8.7 9 8.7 12C8.7 15 9.9 17.9 12 20.2"
        fill="none"
        stroke={g}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <path
        d="M12 3.8C14.1 6.1 15.3 9 15.3 12C15.3 15 14.1 17.9 12 20.2"
        fill="none"
        stroke={g}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}

// Mensajes directos — globo de conversación
export function SidebarMessagesIcon({ size = 18, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <path
        d="M20.5 12.2C20.5 16.1 16.7 19.2 12 19.2C11 19.2 10.1 19.1 9.2 18.9L4.6 20.4L5.7 16.6C4.4 15.4 3.5 13.9 3.5 12.2C3.5 8.3 7.3 5.2 12 5.2C16.7 5.2 20.5 8.3 20.5 12.2Z"
        fill="none"
        stroke={g}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Experiencias — estrella de 5 puntas
export function SidebarExperiencesIcon({ size = 18, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <path
        d="M12 4L14.1 9.2L19.6 9.5L15.3 13.1L16.7 18.5L12 15.5L7.3 18.5L8.7 13.1L4.4 9.5L9.9 9.2Z"
        fill="none"
        stroke={g}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Configuración — MISMO engrane que el subnav del perfil (VibraSubNavIcons →
// `settings`), para que el ajuste se vea igual en los dos lugares donde vive.
// Aquí el color es un parámetro porque el módulo del sidebar lo pide en blanco;
// por omisión mantiene el morado de sus hermanos de este archivo.
//
// El trazo original está descentrado dentro del viewBox 24×24 (su caja cae
// alrededor de 10.3,11). El `translate` lo recentra a 12,12 para que quede a
// plomo con los demás iconos de la columna, sin tocar la silueta.
export function SidebarSettingsIcon({
  size = 18,
  strokeWidth = 1.75,
  color = g,
}: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <g transform="translate(1.7 1)">
        <path
          d="M12 3.2L13.15 5.55C13.72 5.72 14.25 5.95 14.73 6.25L17.25 5.4L18.95 8.35L16.85 10C16.9 10.32 16.93 10.66 16.93 11C16.93 11.34 16.9 11.68 16.85 12L18.95 13.65L17.25 16.6L14.73 15.75C14.25 16.05 13.72 16.28 13.15 16.45L12 18.8H8.6L7.45 16.45C6.88 16.28 6.35 16.05 5.87 15.75L3.35 16.6L1.65 13.65L3.75 12C3.7 11.68 3.67 11.34 3.67 11C3.67 10.66 3.7 10.32 3.75 10L1.65 8.35L3.35 5.4L5.87 6.25C6.35 5.95 6.88 5.72 7.45 5.55L8.6 3.2H12Z"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="10.3"
          cy="11"
          r="2.65"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

// Reloj — usado en Historial de wallet
export function SidebarClockIcon({ size = 18, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={BASE} aria-hidden>
      <circle cx="12" cy="12" r="8.2" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7.5V12.5" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12.5L15.2 14.3" fill="none" stroke={g} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
