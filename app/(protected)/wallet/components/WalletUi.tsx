"use client";

import {
  formatWalletMoney,
  getWalletServiceRowMeta,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";

export function WalletCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
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
          flex-direction: column;
          gap: 6px;
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
        }
      `}</style>

      <div className="card">
        <div className="cardHeader">
          <h2 className="cardTitle">{title}</h2>
          {description ? <p className="cardDescription">{description}</p> : null}
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
}: {
  title: string;
  subtitle: string;
  meta?: string;
}) {
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
        }

        .placeholderTitle {
          font-size: 14px;
          font-weight: 600;
          line-height: 1.3;
          letter-spacing: -0.01em;
          color: #fff;
        }

        .placeholderSubtitle {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.64);
          font-size: 12px;
          line-height: 1.52;
          font-weight: 400;
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
        }
      `}</style>

      <div className="placeholderRow">
        <div className="placeholderMain">
          <div className="placeholderTitle">{title}</div>
          <div className="placeholderSubtitle">{subtitle}</div>
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

export function WalletInlineTabs({
  current,
  onChange,
}: {
  current: "current" | "rejected";
  onChange: (value: "current" | "rejected") => void;
}) {
  return (
    <>
      <style jsx>{`
        .innerTabs {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
          padding: 4px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.09);
        }

        .innerTabButton {
          appearance: none;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.68);
          border-radius: 999px;
          padding: 9px 13px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          transition: background 0.18s ease, color 0.18s ease;
        }

        .innerTabButton:hover {
          color: #ffffff;
        }

        .innerTabButtonActive {
          background: #ffffff;
          color: #000000;
        }

        @media (max-width: 900px) {
          .innerTabs {
            width: 100%;
          }

          .innerTabButton {
            flex: 1 1 0;
            text-align: center;
          }
        }
      `}</style>

      <div className="innerTabs">
        <button
          type="button"
          className={`innerTabButton ${current === "current" ? "innerTabButtonActive" : ""}`}
          onClick={() => onChange("current")}
        >
          Actuales
        </button>

        <button
          type="button"
          className={`innerTabButton ${current === "rejected" ? "innerTabButtonActive" : ""}`}
          onClick={() => onChange("rejected")}
        >
          Rechazados
        </button>
      </div>
    </>
  );
}