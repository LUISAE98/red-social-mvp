"use client";

import { useTranslations } from "next-intl";

export type NotifTab = "experiences" | "social";

interface NotificationTabsProps {
  activeTab: NotifTab;
  onChange: (tab: NotifTab) => void;
  /** Variante compacta para el panel de la campanita (fuente/altura menores). */
  compact?: boolean;
}

/**
 * Subnav de notificaciones (Experiencias | Sociales). Único componente,
 * compartido por la página `/notifications` y el panel de la campanita, para que
 * ambos se vean y se comporten idénticos. Dos pestañas de ancho completo, cada
 * una centrada en su mitad, con barra selectora blanca debajo.
 */
export default function NotificationTabs({
  activeTab,
  onChange,
  compact = false,
}: NotificationTabsProps) {
  const t = useTranslations("notifications");
  const tabs: NotifTab[] = ["experiences", "social"];

  return (
    <div
      className={compact ? "ntabs ntabsCompact" : "ntabs"}
      role="tablist"
      aria-label={t("title")}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          className={activeTab === tab ? "ntab ntabActive" : "ntab"}
          onClick={() => onChange(tab)}
        >
          {t(`tabs.${tab}`)}
        </button>
      ))}

      <style jsx>{`
        .ntabs {
          display: flex;
          padding: 0 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .ntab {
          flex: 1 1 0;
          position: relative;
          padding: 10px 2px 6px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          font-size: 15px;
          font-weight: 500;
          text-align: center;
          cursor: pointer;
          transition: color 140ms ease;
        }
        .ntabsCompact .ntab {
          font-size: 13px;
          padding: 9px 2px 6px;
        }
        .ntab::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 2px;
          border-radius: 2px;
          background: #fff;
          opacity: 0;
          transition: opacity 140ms ease;
        }
        .ntab:hover:not(.ntabActive) {
          color: rgba(255, 255, 255, 0.8);
        }
        .ntabActive {
          color: #fff;
        }
        .ntabActive::after {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
