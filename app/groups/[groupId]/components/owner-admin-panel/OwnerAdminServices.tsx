"use client";

import React, { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  updateOfferings,
  type GroupOffering,
} from "@/lib/groups/updateOfferings";

type Currency = "MXN" | "USD";

type MonetizationInput = {
  isPaid?: boolean;
  priceMonthly?: number | null;
  currency?: Currency | null;
} | null;

type OfferingInput = {
  type: "saludo" | "consejo" | "mensaje" | string;
  enabled?: boolean;
  price?: number | null;
  currency?: Currency | null;
} | null;

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentVisibility?: "public" | "private" | "hidden" | string | null;
  currentMonetization?: MonetizationInput;
  currentOfferings?: OfferingInput[] | null;
};

type ServiceDraft = {
  subscriptionEnabled: boolean;
  subscriptionPrice: string;
  subscriptionCurrency: Currency;
  saludoEnabled: boolean;
  saludoPrice: string;
  saludoCurrency: Currency;
};

function pickSubscription(monetization: MonetizationInput) {
  return {
    enabled: monetization?.isPaid === true,
    price: monetization?.priceMonthly ?? null,
    currency: (monetization?.currency ?? "MXN") as Currency,
  };
}

function pickSaludoOffering(offerings: OfferingInput[] | null | undefined) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === "saludo");

  return {
    enabled: found?.enabled === true,
    price: found?.price ?? null,
    currency: (found?.currency ?? "MXN") as Currency,
  };
}

function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * 0.77;
  return { gross: n, net };
}

function formatMoney(value: number, currency: Currency) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes ownerServicesGearSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          animation: "ownerServicesGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
          opacity: 0.9,
        }}
      >
        ⚙
      </span>
    </>
  );
}

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

export default function OwnerAdminServices({
  groupId,
  ownerId,
  currentUserId,
  currentVisibility = null,
  currentMonetization = null,
  currentOfferings = null,
}: Props) {
  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const isPublic = currentVisibility === "public";

  const [draft, setDraft] = useState<ServiceDraft>({
    subscriptionEnabled: false,
    subscriptionPrice: "",
    subscriptionCurrency: "MXN",
    saludoEnabled: false,
    saludoPrice: "",
    saludoCurrency: "MXN",
  });

  const [savedDraft, setSavedDraft] = useState<ServiceDraft>({
    subscriptionEnabled: false,
    subscriptionPrice: "",
    subscriptionCurrency: "MXN",
    saludoEnabled: false,
    saludoPrice: "",
    saludoCurrency: "MXN",
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sub = pickSubscription(currentMonetization);
    const saludo = pickSaludoOffering(currentOfferings);

    const nextDraft: ServiceDraft = {
      subscriptionEnabled: isPublic ? false : sub.enabled,
      subscriptionPrice:
        isPublic || sub.price == null ? "" : String(sub.price),
      subscriptionCurrency: sub.currency ?? "MXN",
      saludoEnabled: saludo.enabled,
      saludoPrice: saludo.price == null ? "" : String(saludo.price),
      saludoCurrency: saludo.currency ?? "MXN",
    };

    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setMsg(null);
    setErr(null);
  }, [groupId, currentMonetization, currentOfferings, isPublic]);

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
  };

  const panelStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 9,
  };

  const rowBetweenStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
  };

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 12,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: 42,
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    fontFamily: fontStack,
    lineHeight: 1.1,
    width: "100%",
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  const subChanged =
    draft.subscriptionEnabled !== savedDraft.subscriptionEnabled ||
    draft.subscriptionPrice !== savedDraft.subscriptionPrice ||
    draft.subscriptionCurrency !== savedDraft.subscriptionCurrency;

  const saludoChanged =
    draft.saludoEnabled !== savedDraft.saludoEnabled ||
    draft.saludoPrice !== savedDraft.saludoPrice ||
    draft.saludoCurrency !== savedDraft.saludoCurrency;

  const subscriptionCalc =
    draft.subscriptionEnabled && subChanged
      ? calcNetAmount(draft.subscriptionPrice)
      : null;

  const saludoCalc =
    draft.saludoEnabled && saludoChanged
      ? calcNetAmount(draft.saludoPrice)
      : null;

  async function saveServices() {
    setSaving(true);
    setMsg(null);
    setErr(null);

    try {
      const subscriptionPriceNum =
        draft.subscriptionPrice.trim() === ""
          ? null
          : Number(draft.subscriptionPrice);

      const saludoPriceNum =
        draft.saludoPrice.trim() === "" ? null : Number(draft.saludoPrice);

      if (
        draft.subscriptionEnabled &&
        (subscriptionPriceNum == null ||
          Number.isNaN(subscriptionPriceNum) ||
          subscriptionPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para la suscripción mensual.");
        return;
      }

      if (
        draft.saludoEnabled &&
        (saludoPriceNum == null ||
          Number.isNaN(saludoPriceNum) ||
          saludoPriceNum < 0)
      ) {
        setErr("❌ Precio inválido para saludos.");
        return;
      }

      if (isPublic && draft.subscriptionEnabled) {
        setErr(
          "❌ Las comunidades públicas no pueden activar suscripción mensual."
        );
        return;
      }

      const existing = Array.isArray(currentOfferings) ? currentOfferings : [];
      const nextOfferings: GroupOffering[] = [];

      const hasType = (t: string) =>
        existing.some((o: any) => String(o?.type) === t);

      nextOfferings.push({
        type: "saludo",
        enabled: draft.saludoEnabled,
        price: draft.saludoEnabled ? saludoPriceNum : null,
        currency: draft.saludoEnabled ? draft.saludoCurrency : null,
      });

      if (hasType("consejo")) {
        const o = existing.find((x: any) => String(x?.type) === "consejo") as any;
        nextOfferings.push({
          type: "consejo",
          enabled: o?.enabled === true,
          price: o?.price ?? null,
          currency: o?.currency ?? null,
        });
      }

      if (hasType("mensaje")) {
        const o = existing.find((x: any) => String(x?.type) === "mensaje") as any;
        nextOfferings.push({
          type: "mensaje",
          enabled: o?.enabled === true,
          price: o?.price ?? null,
          currency: o?.currency ?? null,
        });
      }

      await updateDoc(doc(db, "groups", groupId), {
        monetization: {
          isPaid: isPublic ? false : draft.subscriptionEnabled,
          priceMonthly:
            isPublic || !draft.subscriptionEnabled ? null : subscriptionPriceNum,
          currency:
            isPublic || !draft.subscriptionEnabled
              ? null
              : draft.subscriptionCurrency,
        },
      });

      await updateOfferings(groupId, nextOfferings);

      const nextSaved: ServiceDraft = {
        subscriptionEnabled: isPublic ? false : draft.subscriptionEnabled,
        subscriptionPrice:
          isPublic || !draft.subscriptionEnabled ? "" : draft.subscriptionPrice,
        subscriptionCurrency: draft.subscriptionCurrency,
        saludoEnabled: draft.saludoEnabled,
        saludoPrice: draft.saludoEnabled ? draft.saludoPrice : "",
        saludoCurrency: draft.saludoCurrency,
      };

      setDraft(nextSaved);
      setSavedDraft(nextSaved);
      setMsg("✅ Servicios del grupo guardados.");
    } catch (e: any) {
      setErr(e?.message ?? "❌ No se pudieron guardar los servicios.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={contentStyle}>
      <div style={panelStyle}>
        <div style={rowBetweenStyle}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={titleStyle}>Suscripción mensual</span>
            <span style={subtleStyle}>
              Define si tu comunidad cobra acceso mensual.
            </span>
          </div>

          <Switch
            checked={draft.subscriptionEnabled}
            disabled={saving || isPublic}
            onChange={(next) =>
              setDraft((prev) => ({
                ...prev,
                subscriptionEnabled: next,
                subscriptionPrice: next ? prev.subscriptionPrice : "",
              }))
            }
            label="Activar suscripción mensual"
          />
        </div>

        {draft.subscriptionEnabled && !isPublic && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="number"
                value={draft.subscriptionPrice}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    subscriptionPrice: e.target.value,
                  }))
                }
                placeholder="Precio mensual"
                style={{ ...inputStyle, width: 116 }}
              />

              <select
                value={draft.subscriptionCurrency}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    subscriptionCurrency: e.target.value as Currency,
                  }))
                }
                style={{ ...inputStyle, flex: 1, minWidth: 82 }}
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>

            {subscriptionCalc && (
              <div style={subtleStyle}>
                Por una suscripción de{" "}
                {formatMoney(
                  subscriptionCalc.gross,
                  draft.subscriptionCurrency
                )}
                , tú cobras{" "}
                {formatMoney(subscriptionCalc.net, draft.subscriptionCurrency)}
              </div>
            )}
          </>
        )}

        {isPublic && (
          <div style={subtleStyle}>
            Para activar suscripción mensual tu comunidad debe ser privada u
            oculta.
          </div>
        )}
      </div>

      <div style={panelStyle}>
        <div style={rowBetweenStyle}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={titleStyle}>Saludos en comunidad</span>
            <span style={subtleStyle}>
              Activa o desactiva la compra de saludos desde este grupo.
            </span>
          </div>

          <Switch
            checked={draft.saludoEnabled}
            disabled={saving}
            onChange={(next) =>
              setDraft((prev) => ({
                ...prev,
                saludoEnabled: next,
                saludoPrice: next ? prev.saludoPrice : "",
              }))
            }
            label="Saludos activos en esta comunidad"
          />
        </div>

        {draft.saludoEnabled && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="number"
                value={draft.saludoPrice}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    saludoPrice: e.target.value,
                  }))
                }
                placeholder="Precio"
                style={{ ...inputStyle, width: 100 }}
              />

              <select
                value={draft.saludoCurrency}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    saludoCurrency: e.target.value as Currency,
                  }))
                }
                style={{ ...inputStyle, flex: 1, minWidth: 82 }}
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>

            {saludoCalc && (
              <div style={subtleStyle}>
                Por un saludo de{" "}
                {formatMoney(saludoCalc.gross, draft.saludoCurrency)}, tú cobras{" "}
                {formatMoney(saludoCalc.net, draft.saludoCurrency)}
              </div>
            )}
          </>
        )}
      </div>

      {err && <div style={noticeStyle}>{err}</div>}
      {msg && <div style={noticeStyle}>{msg}</div>}

      <button
        type="button"
        onClick={saveServices}
        disabled={saving}
        style={{
          ...buttonSecondaryStyle,
          opacity: saving ? 0.7 : 1,
          cursor: saving ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {saving ? (
          <>
            <SpinningGear />
            Guardando...
          </>
        ) : (
          "Guardar cambios"
        )}
      </button>
    </div>
  );
}