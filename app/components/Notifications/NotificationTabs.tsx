"use client";

import { useTranslations } from "next-intl";

export type NotifTab = "experiences" | "social";

interface NotificationTabsProps {
  activeTab: NotifTab;
  onChange: (tab: NotifTab) => void;
  /** Variante compacta para el panel de la campanita (fuente/altura menores). */
  compact?: boolean;
  /** Conteo por pestaña, mostrado tras el título (se omite si es 0). */
  counts?: Partial<Record<NotifTab, number>>;
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
  const activeIndex = Math.max(0, tabs.indexOf(activeTab));

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

      {/* Barra selectora única que desliza entre pestañas (como el subnav de wallet). */}
      <span
        className="ntabIndicator"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
        aria-hidden="true"
      />

      <style jsx>{`
        .ntabs {
          position: relative;
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
        .ntab:hover:not(.ntabActive) {
          color: rgba(255, 255, 255, 0.8);
        }
        .ntabActive {
          color: #fff;
        }
        .ntabIndicator {
          position: absolute;
          bottom: 0;
          left: 16px;
          width: calc((100% - 32px) / 2);
          height: 2px;
          border-radius: 2px;
          background: #fff;
          transition: transform 280ms cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
