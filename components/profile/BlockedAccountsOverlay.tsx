"use client";

import Link from "next/link";
import { intlLocale } from "@/i18n/locales";
import { useTranslations, useLocale } from "next-intl";
import { CSSProperties, useEffect, useMemo, useState } from "react";

import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
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

function formatBlockedDate(
  value: BlockedProfileAccount["createdAt"],
  fallback: string,
  locale: string
) {
  if (!value?.toDate) return fallback;

  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(value.toDate());
  } catch {
    return fallback;
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
  const locale = useLocale();
  const tProfile = useTranslations("profile");
  const tCommon = useTranslations("common");

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
        setError(err.message || tProfile("blockLoadError"));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) ?? tProfile("unblockError"));
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
      } catch (err: unknown) {
        setError(
          (err instanceof Error ? err.message : null) ?? tProfile("unblockGroupError")
        );
      } finally {
        setBusyKey(null);
      }
    }
  }

  const fontStack =
    'inherit';

  const dateUnavailable = tProfile("dateUnavailable");

  return (
    <VibraResponsivePanel
      open={open}
      onClose={onClose}
      title={tProfile("blockedAccountsTitle")}
      subtitle={tProfile("blockedAccountsDesc")}
      closeAriaLabel={tCommon("closeAriaLabel")}
      maxWidthDesktop={480}
      contentPadding="0"
    >
      <div>
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: "rgba(8,9,11,0.96)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              padding: "0 8px",
            }}
          >
            {/* Indicador deslizante bajo la pestaña activa */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                insetInlineStart: 8,
                bottom: 0,
                width: "calc((100% - 16px) / 2)",
                height: 2,
                pointerEvents: "none",
                transform: `translate3d(${activeTab === "profile" ? 0 : 100}%, 0, 0)`,
                transition: "transform 360ms cubic-bezier(0.2, 0.9, 0.2, 1)",
                willChange: "transform",
                zIndex: 2,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "72%",
                  height: 2,
                  borderRadius: 999,
                  background: "#fff",
                }}
              />
            </span>

            {(["profile", "groups"] as ActiveTab[]).map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  aria-pressed={active}
                  style={{
                    position: "relative",
                    zIndex: 1,
                    minHeight: 38,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fontStack,
                    letterSpacing: "-0.01em",
                    color: active ? "#fff" : "rgba(255,255,255,0.45)",
                    transition: "color 0.2s ease",
                    padding: "10px 6px 5px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab === "profile"
                    ? tProfile("blockedProfiles")
                    : tProfile("blockedInCommunities")}
                </button>
              );
            })}
          </div>
        </div>

        <main
          style={{
            padding: 14,
            display: "grid",
            gap: 10,
            minHeight: 0,
          }}
        >
          {uid && !loading && !error && activeItems.length > 0 && (
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: "rgba(255,255,255,0.42)",
                padding: "0 2px",
              }}
            >
              {tProfile("blockedCountLabel", { count: activeItems.length })}
            </div>
          )}

          {!uid && (
            <EmptyState text={tProfile("blockedLoginRequired")} />
          )}

          {uid && loading && (
            <EmptyState text={tProfile("blockedAccountsLoading")} />
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

          {uid && !loading && !error && activeItems.length === 0 && (
            <div
              style={{
                minHeight: 280,
                display: "grid",
                placeItems: "center",
                fontSize: 13,
                lineHeight: 1.45,
                color: "rgba(255,255,255,0.6)",
                textAlign: "center",
              }}
            >
              {tProfile("noBlockedUsers")}
            </div>
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
                    border: "1px solid transparent",
                    background: "transparent",
                    padding: "12px 2px",
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
      fontWeight: 500,
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
      fontWeight: 500,
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
                        {tProfile("blockedOnDate", {
                          date: formatBlockedDate(account.createdAt, dateUnavailable, locale),
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    className="blocked-account-action"
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleUnblockProfile(account)}
                    style={{
                      height: 36,
                      padding: "0 16px",
                      borderRadius: 6,
                      border: "none",
                      background: "rgba(255,255,255,0.10)",
                      color: "rgba(255,255,255,0.70)",
                      fontWeight: 500,
                      fontSize: 13,
                      fontFamily: fontStack,
                      opacity: isBusy ? 0.7 : 1,
                      cursor: isBusy ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isBusy ? tProfile("unblockingLabel") : tProfile("unblockLabel")}
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
                    border: "1px solid transparent",
                    background: "transparent",
                    padding: "12px 2px",
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        {account.user.handle ? (
                          <Link
                            href={`/u/${account.user.handle}`}
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              color: "#fff",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              textDecoration: "none",
                              flex: "0 1 auto",
                              minWidth: 0,
                            }}
                          >
                            {account.user.displayName}
                          </Link>
                        ) : (
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              color: "#fff",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: "0 1 auto",
                              minWidth: 0,
                            }}
                          >
                            {account.user.displayName}
                          </div>
                        )}

                        <Link
                          href={`/groups/${account.groupId}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            minWidth: 0,
                            flexShrink: 0,
                            textDecoration: "none",
                            color: "rgba(255,255,255,0.64)",
                          }}
                        >
                          <InitialAvatar
                            label={account.group.name}
                            imageUrl={account.group.avatarUrl ?? account.group.imageUrl}
                            size={16}
                          />
                          <span
                            style={{
                              minWidth: 0,
                              maxWidth: 130,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 10.5,
                              fontWeight: 500,
                              letterSpacing: "-0.01em",
                              color: "rgba(255,255,255,0.64)",
                            }}
                          >
                            {account.group.name}
                          </span>
                        </Link>
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.56)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tProfile("blockedOnDate", {
                          date: formatBlockedDate(account.createdAt, dateUnavailable, locale),
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    className="blocked-account-action"
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleUnblockGroup(account)}
                    style={{
                      height: 36,
                      padding: "0 16px",
                      borderRadius: 6,
                      border: "none",
                      background: "rgba(255,255,255,0.10)",
                      color: "rgba(255,255,255,0.70)",
                      fontWeight: 500,
                      fontSize: 13,
                      fontFamily: fontStack,
                      opacity: isBusy ? 0.7 : 1,
                      cursor: isBusy ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isBusy ? tProfile("unblockingLabel") : tProfile("unblockLabel")}
                  </button>
                </div>
              );
            })}
        </main>
      </div>
    </VibraResponsivePanel>
  );
}
