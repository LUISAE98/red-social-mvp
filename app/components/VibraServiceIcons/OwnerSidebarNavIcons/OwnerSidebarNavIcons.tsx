"use client";

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
