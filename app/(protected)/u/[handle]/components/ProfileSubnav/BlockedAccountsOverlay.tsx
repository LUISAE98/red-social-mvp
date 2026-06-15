"use client";

import Link from "next/link";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  type BlockedGroupAccount,
  type BlockedProfileAccount,
  subscribeBlockedAccounts,
  unblockGroupBlockedAccount,
  unblockProfileBlockedAccount,
} from "@/lib/social/blockedAccounts";

type BlockedAccountsOverlayProps = {
  open: boolean;
  currentUserId: string | null | undefined;
  onClose: () => void;
};

type ActiveTab = "profile" | "groups";

function formatBlockedDate(value: BlockedProfileAccount["createdAt"]) {
  if (!value?.toDate) return "Fecha no disponible";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(value.toDate());
  } catch {
    return "Fecha no disponible";
  }
}

function InitialAvatar({
  label,
  imageUrl,
  size = 42,
}: {
  label: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const initial = label.trim().charAt(0).toUpperCase() || "U";

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flex: "0 0 auto",
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.08)",
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontSize: Math.max(12, size * 0.36),
        fontWeight: 800,
      }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        initial
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px dashed rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.04)",
        padding: 18,
        color: "rgba(255,255,255,0.62)",
        fontSize: 13,
        lineHeight: 1.45,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

export default function BlockedAccountsOverlay({
  open,
  currentUserId,
  onClose,
}: BlockedAccountsOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("profile");
  const [profileBlocks, setProfileBlocks] = useState<BlockedProfileAccount[]>(
    []
  );
  const [groupBlocks, setGroupBlocks] = useState<BlockedGroupAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uid = currentUserId?.trim() || "";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !uid) {
      setProfileBlocks([]);
      setGroupBlocks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsubscribe = subscribeBlockedAccounts(
      uid,
      (state) => {
        setProfileBlocks(state.profileBlocks);
        setGroupBlocks(state.groupBlocks);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "No se pudieron cargar las cuentas bloqueadas.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [open, uid]);

  const activeItems = useMemo(() => {
    return activeTab === "profile" ? profileBlocks : groupBlocks;
  }, [activeTab, profileBlocks, groupBlocks]);

  async function handleUnblockProfile(account: BlockedProfileAccount) {
    if (!uid || busyKey) return;

    const key = `profile:${account.blockedUserId}`;
    setBusyKey(key);
    setError(null);

    try {
      await unblockProfileBlockedAccount({
        currentUserId: uid,
        blockedUserId: account.blockedUserId,
      });
    } catch (err: any) {
      setError(err?.message ?? "No se pudo desbloquear este perfil.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUnblockGroup(account: BlockedGroupAccount) {
    if (!busyKey) {
      const key = `group:${account.groupId}:${account.blockedUserId}`;
      setBusyKey(key);
      setError(null);

      try {
        await unblockGroupBlockedAccount({
          groupId: account.groupId,
          blockedUserId: account.blockedUserId,
        });
      } catch (err: any) {
        setError(
          err?.message ?? "No se pudo desbloquear esta cuenta en la comunidad."
        );
      } finally {
        setBusyKey(null);
      }
    }
  }

  if (!open || !mounted || typeof document === "undefined") return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const buttonStyle: CSSProperties = {
    minHeight: 34,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const tabButton = (tab: ActiveTab): CSSProperties => ({
    ...buttonStyle,
    background: activeTab === tab ? "#fff" : "rgba(255,255,255,0.07)",
    color: activeTab === tab ? "#000" : "#fff",
  });

  const cardStyle: CSSProperties = {
    width: "min(760px, calc(100vw - 28px))",
    maxHeight: "calc(100dvh - 28px)",
    overflow: "hidden",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.16)",
    background:
      "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
    color: "#fff",
    boxShadow: "0 24px 90px rgba(0,0,0,0.78)",
    fontFamily: fontStack,
    boxSizing: "border-box",
    display: "grid",
    gridTemplateRows: "auto auto minmax(0, 1fr)",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cuentas bloqueadas"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.76)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(14px, env(safe-area-inset-top)) 14px max(14px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
      }}
    >
      <div style={cardStyle} onClick={(event) => event.stopPropagation()}>
        <style jsx>{`
          @media (max-width: 560px) {
            .blocked-account-row {
              grid-template-columns: 1fr !important;
            }

            .blocked-account-action {
              width: 100%;
            }

            .blocked-account-tabs {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>

        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: 18,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                lineHeight: 1.2,
                fontWeight: 850,
                color: "#fff",
              }}
            >
              Cuentas bloqueadas
            </h2>

            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12.5,
                lineHeight: 1.45,
                color: "rgba(255,255,255,0.58)",
              }}
            >
              Administra perfiles bloqueados y bloqueos dentro de comunidades.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              ...buttonStyle,
              minWidth: 38,
              padding: "8px 10px",
              fontSize: 16,
              lineHeight: 1,
            }}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        <div
          className="blocked-account-tabs"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            padding: 14,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <button
            type="button"
            style={tabButton("profile")}
            onClick={() => setActiveTab("profile")}
          >
            Perfil ({profileBlocks.length})
          </button>

          <button
            type="button"
            style={tabButton("groups")}
            onClick={() => setActiveTab("groups")}
          >
            Comunidades ({groupBlocks.length})
          </button>
        </div>

        <main
          style={{
            overflowY: "auto",
            padding: 14,
            display: "grid",
            gap: 10,
            minHeight: 0,
          }}
        >
          {!uid && (
            <EmptyState text="Inicia sesión para ver tus cuentas bloqueadas." />
          )}

          {uid && loading && (
            <EmptyState text="Cargando cuentas bloqueadas..." />
          )}

          {uid && error && (
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,90,90,0.28)",
                background: "rgba(255,90,90,0.10)",
                color: "rgba(255,255,255,0.88)",
                padding: 12,
                fontSize: 12.5,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          {uid && !loading && activeItems.length === 0 && (
            <EmptyState
              text={
                activeTab === "profile"
                  ? "No tienes perfiles bloqueados."
                  : "No tienes cuentas bloqueadas dentro de comunidades."
              }
            />
          )}

          {activeTab === "profile" &&
            profileBlocks.map((account) => {
              const key = `profile:${account.blockedUserId}`;
              const isBusy = busyKey === key;

              return (
                <div
                  className="blocked-account-row"
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.09)",
                    background: "rgba(255,255,255,0.04)",
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      minWidth: 0,
                    }}
                  >
                    <InitialAvatar
                      label={account.user.displayName}
                      imageUrl={account.user.photoURL}
                    />

                    <div style={{ minWidth: 0 }}>
{account.user.handle ? (
  <Link
    href={`/u/${account.user.handle}`}
    style={{
      fontSize: 14,
      fontWeight: 800,
      color: "#fff",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textDecoration: "none",
      display: "block",
    }}
  >
    {account.user.displayName}
  </Link>
) : (
  <div
    style={{
      fontSize: 14,
      fontWeight: 800,
      color: "#fff",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
  >
    {account.user.displayName}
  </div>
)}

                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.56)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {account.user.handle
                          ? `@${account.user.handle}`
                          : "Perfil bloqueado"}{" "}
                        · {formatBlockedDate(account.createdAt)}
                      </div>
                    </div>
                  </div>

                  <button
                    className="blocked-account-action"
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleUnblockProfile(account)}
                    style={{
                      ...buttonStyle,
                      background: isBusy ? "rgba(255,255,255,0.12)" : "#fff",
                      color: isBusy ? "#fff" : "#000",
                      opacity: isBusy ? 0.75 : 1,
                      cursor: isBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {isBusy ? "Desbloqueando..." : "Desbloquear"}
                  </button>
                </div>
              );
            })}

          {activeTab === "groups" &&
            groupBlocks.map((account) => {
              const key = `group:${account.groupId}:${account.blockedUserId}`;
              const isBusy = busyKey === key;

              return (
                <div
                  className="blocked-account-row"
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.09)",
                    background: "rgba(255,255,255,0.04)",
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      minWidth: 0,
                    }}
                  >
                    <InitialAvatar
                      label={account.user.displayName}
                      imageUrl={account.user.photoURL}
                    />

                    <div style={{ minWidth: 0 }}>
{account.user.handle ? (
  <Link
    href={`/u/${account.user.handle}`}
    style={{
      fontSize: 14,
      fontWeight: 800,
      color: "#fff",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textDecoration: "none",
      display: "block",
    }}
  >
    {account.user.displayName}
  </Link>
) : (
  <div
    style={{
      fontSize: 14,
      fontWeight: 800,
      color: "#fff",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
  >
    {account.user.displayName}
  </div>
)}

                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.56)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {account.user.handle
                          ? `@${account.user.handle}`
                          : "Usuario bloqueado"}{" "}
                        · {formatBlockedDate(account.createdAt)}
                      </div>

<Link
  href={`/groups/${account.groupId}`}
  style={{
    marginTop: 8,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    maxWidth: "100%",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    padding: "5px 8px",
    fontSize: 11.5,
    color: "rgba(255,255,255,0.72)",
    textDecoration: "none",
  }}
>
  <InitialAvatar
    label={account.group.name}
    imageUrl={account.group.avatarUrl ?? account.group.imageUrl}
    size={20}
  />
  <span
    style={{
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
  >
    {account.group.name}
  </span>
</Link>
                    </div>
                  </div>

                  <button
                    className="blocked-account-action"
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleUnblockGroup(account)}
                    style={{
                      ...buttonStyle,
                      background: isBusy ? "rgba(255,255,255,0.12)" : "#fff",
                      color: isBusy ? "#fff" : "#000",
                      opacity: isBusy ? 0.75 : 1,
                      cursor: isBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {isBusy ? "Desbloqueando..." : "Desbloquear"}
                  </button>
                </div>
              );
            })}
        </main>
      </div>
    </div>,
    document.body
  );
}