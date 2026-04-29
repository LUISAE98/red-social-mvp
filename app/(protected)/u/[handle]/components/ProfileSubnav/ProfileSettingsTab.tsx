"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

type ProfileSettingsTabProps = {
  isSaving?: boolean;
  isRestricted: boolean;
  onToggleRestricted: (nextValue: boolean) => Promise<void> | void;

  displayName?: string | null;
  username?: string | null;
  birthDate?: string | Date | null;
  appCreatedAt?: string | Date | null;
};

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
      title={label}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 160ms ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
        }}
      />
    </button>
  );
}

function formatDate(value?: string | Date | null) {
  if (!value) return "No disponible";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "No disponible";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function ProfileInfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const itemWrap: CSSProperties = {
    display: "grid",
    gap: 6,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    minWidth: 0,
  };

  const itemLabel: CSSProperties = {
    margin: 0,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };

  const itemValue: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  };

  return (
    <div style={itemWrap}>
      <p style={itemLabel}>{label}</p>
      <p style={itemValue}>{value}</p>
    </div>
  );
}

export default function ProfileSettingsTab({
  isSaving = false,
  isRestricted,
  onToggleRestricted,
  displayName,
  username,
  birthDate,
  appCreatedAt,
}: ProfileSettingsTabProps) {
  const [localRestricted, setLocalRestricted] = useState(isRestricted);

  useEffect(() => {
    setLocalRestricted(isRestricted);
  }, [isRestricted]);

  const saving = isSaving;

  const statusText = useMemo(() => {
    if (saving) return "Guardando cambios...";
    return localRestricted ? "Perfil reservado activado" : "Perfil público";
  }, [localRestricted, saving]);

  async function handleChange(nextValue: boolean) {
    if (saving) return;

    setLocalRestricted(nextValue);

    try {
      await onToggleRestricted(nextValue);
    } catch (error) {
      setLocalRestricted(!nextValue);
      console.error("No se pudo actualizar la restricción del perfil:", error);
    }
  }

  const wrap: CSSProperties = {
    width: "100%",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 20,
    background: "rgba(18,18,20,0.92)",
    padding: 18,
    display: "grid",
    gap: 16,
    boxSizing: "border-box",
    overflow: "hidden",
  };

  const header: CSSProperties = {
    display: "grid",
    gap: 6,
  };

  const title: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: -0.2,
    lineHeight: 1.15,
  };

  const description: CSSProperties = {
    margin: 0,
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 1.5,
  };

  const sectionTitle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.2,
  };

  const infoGrid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  };

  const row: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 0",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    minWidth: 0,
  };

  const textCol: CSSProperties = {
    display: "grid",
    gap: 6,
    minWidth: 0,
    flex: 1,
  };

  const switchWrap: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 0,
    minWidth: 40,
  };

  const rowTitle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.2,
  };

  const rowText: CSSProperties = {
    margin: 0,
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    lineHeight: 1.45,
  };

  const badge: CSSProperties = {
    justifySelf: "start",
    padding: "8px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color: localRestricted ? "#111214" : "#fff",
    background: localRestricted ? "#fff" : "rgba(255,255,255,0.08)",
    lineHeight: 1.2,
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  const note: CSSProperties = {
    margin: 0,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    lineHeight: 1.45,
  };

  const resolvedDisplayName = displayName?.trim() || "No disponible";
  const resolvedUsername = username?.trim()
    ? `@${username.trim()}`
    : "No disponible";
  const resolvedBirthDate = formatDate(birthDate);
  const resolvedAppCreatedAt = formatDate(appCreatedAt);

  return (
    <section style={wrap}>
      <style jsx>{`
        @media (max-width: 640px) {
          .profile-settings-row {
            flex-direction: column;
            align-items: stretch;
          }

          .profile-settings-switch {
            width: 100%;
            justify-content: flex-start;
            padding-top: 2px;
          }

          .profile-settings-info-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div style={header}>
        <h3 style={title}>Configuración del perfil</h3>
        <p style={description}>
          Aquí vas a centralizar la configuración principal del perfil. Por ahora
          dejamos visible la información base de la cuenta y el control de
          privacidad del perfil.
        </p>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <p style={sectionTitle}>Datos del perfil</p>

        <div className="profile-settings-info-grid" style={infoGrid}>
          <ProfileInfoItem label="Nombre" value={resolvedDisplayName} />
          <ProfileInfoItem label="Usuario" value={resolvedUsername} />
          <ProfileInfoItem
            label="Fecha de nacimiento"
            value={resolvedBirthDate}
          />
          <ProfileInfoItem
            label="Fecha de creación"
            value={resolvedAppCreatedAt}
          />
        </div>
      </div>

      <div className="profile-settings-row" style={row}>
        <div style={textCol}>
          <p style={rowTitle}>Perfil reservado</p>
          <p style={rowText}>
            Al activarlo, nadie podrá ver publicaciones desde tu perfil. Debe
            mostrarse la leyenda “perfil reservado” tanto a usuarios logueados
            como no logueados. Esto solo aplica dentro del perfil, no dentro de
            las comunidades compartidas.
          </p>
        </div>

        <div className="profile-settings-switch" style={switchWrap}>
          <Switch
            checked={localRestricted}
            disabled={saving}
            onChange={handleChange}
            label={
              localRestricted
                ? "Desactivar perfil reservado"
                : "Activar perfil reservado"
            }
          />
        </div>
      </div>

      <span style={badge}>{statusText}</span>

      <p style={note}>
        Esta configuración solo controla la privacidad general del perfil.
      </p>
    </section>
  );
}