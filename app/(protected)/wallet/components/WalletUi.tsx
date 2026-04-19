"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatWalletMoney,
  getWalletServiceRowMeta,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";

function getServiceEmoji(row: WalletServiceItem): string {
  if (row.status === "rejected" || row.status === "cancelled") {
    return "❌";
  }

  if (row.status === "refund_requested" || row.status === "refund_review") {
    return "💸";
  }

  switch (row.kind) {
    case "saludo":
      return "👋";
    case "consejo":
      return "💡";
    case "meet_greet":
      return "🤝";
    case "mensaje":
      return "💬";
    default:
      return "✨";
  }
}

function getStatusTone(row: WalletServiceItem): "default" | "danger" | "warning" {
  if (row.status === "rejected" || row.status === "cancelled") {
    return "danger";
  }

  if (row.status === "refund_requested" || row.status === "refund_review") {
    return "warning";
  }

  return "default";
}

export function WalletCard({
  title,
  description,
  headerRight,
  children,
}: {
  title: string;
  description?: string;
  headerRight?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <style jsx>{`
        .card {
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.05) 0%,
            rgba(255, 255, 255, 0.025) 100%
          );
          padding: 18px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
        }

        .cardHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .cardHeaderMain {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .cardHeaderRight {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .cardTitle {
          margin: 0;
          font-size: 18px;
          line-height: 1.15;
          letter-spacing: -0.02em;
          font-weight: 600;
          color: #fff;
        }

        .cardDescription {
          margin: 0;
          color: rgba(255, 255, 255, 0.68);
          font-size: 13px;
          line-height: 1.55;
          font-weight: 400;
        }

        .cardBody {
          margin-top: 16px;
        }

        @media (max-width: 900px) {
          .card {
            border-radius: 18px;
            padding: 15px;
          }

          .cardTitle {
            font-size: 17px;
          }

          .cardHeader {
            align-items: flex-start;
          }
        }
      `}</style>

      <div className="card">
        <div className="cardHeader">
          <div className="cardHeaderMain">
            <h2 className="cardTitle">{title}</h2>
            {description ? <p className="cardDescription">{description}</p> : null}
          </div>

          {headerRight ? <div className="cardHeaderRight">{headerRight}</div> : null}
        </div>

        {children ? <div className="cardBody">{children}</div> : null}
      </div>
    </>
  );
}

export function WalletErrorBox({
  message,
}: {
  message: string;
}) {
  return (
    <>
      <style jsx>{`
        .errorBox {
          margin-bottom: 14px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid rgba(248, 113, 113, 0.24);
          background: rgba(248, 113, 113, 0.09);
          color: #fca5a5;
          font-size: 13px;
          line-height: 1.5;
        }
      `}</style>

      <div className="errorBox">{message}</div>
    </>
  );
}

export function PlaceholderRow({
  title,
  subtitle,
  meta,
  emoji,
  statusTone = "default",
}: {
  title: string;
  subtitle: string;
  meta?: string;
  emoji?: string;
  statusTone?: "default" | "danger" | "warning";
}) {
  const subtitleClass =
    statusTone === "danger"
      ? "placeholderSubtitleDanger"
      : statusTone === "warning"
        ? "placeholderSubtitleWarning"
        : "placeholderSubtitle";

  return (
    <>
      <style jsx>{`
        .placeholderRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 13px 14px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background: rgba(255, 255, 255, 0.028);
        }

        .placeholderMain {
          min-width: 0;
          flex: 1;
        }

        .titleRow {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .placeholderTitle {
          font-size: 14px;
          font-weight: 600;
          line-height: 1.3;
          letter-spacing: -0.01em;
          color: #fff;
        }

        .desktopEmoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          line-height: 1;
          flex-shrink: 0;
        }

        .mobileEmoji {
          display: none;
          flex-shrink: 0;
          font-size: 18px;
          line-height: 1;
          margin-left: auto;
        }

        .placeholderSubtitle {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.64);
          font-size: 12px;
          line-height: 1.52;
          font-weight: 400;
        }

        .placeholderSubtitleDanger {
          margin-top: 4px;
          color: #f87171;
          font-size: 12px;
          line-height: 1.52;
          font-weight: 500;
        }

        .placeholderSubtitleWarning {
          margin-top: 4px;
          color: #facc15;
          font-size: 12px;
          line-height: 1.52;
          font-weight: 500;
        }

        .placeholderMeta {
          flex-shrink: 0;
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(255, 255, 255, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.11);
          color: rgba(255, 255, 255, 0.82);
          font-size: 11px;
          font-weight: 500;
          line-height: 1;
        }

        @media (max-width: 900px) {
          .placeholderRow {
            flex-direction: column;
            align-items: flex-start;
          }

          .placeholderMeta {
            margin-top: 2px;
          }

          .desktopEmoji {
            display: none;
          }

          .mobileEmoji {
            display: inline-flex;
          }

          .titleRow {
            width: 100%;
          }
        }
      `}</style>

      <div className="placeholderRow">
        <div className="placeholderMain">
          <div className="titleRow">
            <div className="placeholderTitle">{title}</div>
            {emoji ? <span className="desktopEmoji">{emoji}</span> : null}
            {emoji ? <span className="mobileEmoji">{emoji}</span> : null}
          </div>

          <div className={subtitleClass}>{subtitle}</div>
        </div>

        {meta ? <div className="placeholderMeta">{meta}</div> : null}
      </div>
    </>
  );
}

export function EmptyRows({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <PlaceholderRow title={title} subtitle={subtitle} meta="Vacío" />
    </div>
  );
}

function buildRowSubtitle(row: WalletServiceItem): string {
  const chunks: string[] = [];

  if (row.groupName) {
    chunks.push(row.groupName);
  }

  chunks.push(row.statusLabel);

  if (row.priceSnapshot != null) {
    chunks.push(formatWalletMoney(row.priceSnapshot));
  }

  if (row.description) {
    chunks.push(row.description);
  }

  if (row.rejectionReason) {
    chunks.push(`Motivo: ${row.rejectionReason}`);
  }

  if (row.refundReason) {
    chunks.push(`Devolución: ${row.refundReason}`);
  }

  return chunks.join(" · ");
}

export function WalletServiceRow({
  row,
}: {
  row: WalletServiceItem;
}) {
  return (
    <PlaceholderRow
      title={row.title}
      subtitle={buildRowSubtitle(row)}
      meta={getWalletServiceRowMeta(row)}
      emoji={getServiceEmoji(row)}
      statusTone={getStatusTone(row)}
    />
  );
}

export function WalletList({
  items,
}: {
  items: WalletServiceItem[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((row) => (
        <WalletServiceRow key={`${row.source}-${row.id}`} row={row} />
      ))}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M7 12h13" />
      <path d="M10 17h10" />
    </svg>
  );
}

export function WalletFilterMenu<T extends string>({
  label = "Filtro",
  menuLabel,
  value,
  options,
  onChange,
}: {
  label?: string;
  menuLabel: string;
  value: T;
  options: Array<{ value: T; label: string; emoji?: string }>;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <>
      <style jsx>{`
        .filterWrapper {
          position: relative;
        }

        .filterButton {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          padding: 9px 12px;
          color: rgba(255, 255, 255, 0.88);
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
          transition:
            background 0.18s ease,
            border-color 0.18s ease;
        }

        .filterButton:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .filterMenu {
          position: absolute;
          right: 0;
          top: calc(100% + 8px);
          z-index: 30;
          width: 240px;
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: #121212;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
        }

        .filterMenuHeader {
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding: 11px 12px;
          color: rgba(255, 255, 255, 0.52);
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .filterMenuBody {
          padding: 8px;
        }

        .filterMenuItem {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border: none;
          background: transparent;
          border-radius: 12px;
          padding: 10px 12px;
          color: rgba(255, 255, 255, 0.82);
          font-size: 13px;
          font-weight: 500;
          text-align: left;
          transition: background 0.18s ease, color 0.18s ease;
        }

        .filterMenuItem:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
        }

        .filterMenuItemActive {
          background: #ffffff;
          color: #000000;
        }

        .filterMenuItemActive:hover {
          background: #ffffff;
          color: #000000;
        }

        .filterMenuItemLeft {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .filterMenuEmoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          flex-shrink: 0;
          font-size: 14px;
          line-height: 1;
        }

        .filterMenuStatus {
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          opacity: 0.72;
        }
      `}</style>

      <div ref={wrapperRef} className="filterWrapper">
        <button
          type="button"
          className="filterButton"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <FilterIcon />
          <span>{label}</span>
        </button>

        {open ? (
          <div className="filterMenu" role="menu">
            <div className="filterMenuHeader">{menuLabel}</div>

            <div className="filterMenuBody">
              {options.map((option) => {
                const isActive = option.value === value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`filterMenuItem ${isActive ? "filterMenuItemActive" : ""}`}
                  >
                    <span className="filterMenuItemLeft">
                      {option.emoji ? (
                        <span className="filterMenuEmoji">{option.emoji}</span>
                      ) : null}
                      <span>{option.label}</span>
                    </span>

                    {isActive ? (
                      <span className="filterMenuStatus">Activo</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}