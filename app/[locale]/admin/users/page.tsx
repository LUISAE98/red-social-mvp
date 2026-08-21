"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
  startAt,
  endAt,
  Timestamp,
} from "firebase/firestore";
import { useTranslations } from "next-intl";
import { db } from "@/lib/firebase";

type UserDoc = {
  uid: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  platformBanned: boolean;
  createdAt: Date | null;
};

type Tab = "banned" | "search";

function toUserDoc(id: string, d: Record<string, unknown>): UserDoc {
  const raw = d as {
    handle?: string;
    displayName?: string;
    email?: string;
    platformBanned?: boolean;
    createdAt?: Timestamp;
  };
  return {
    uid: id,
    handle: raw.handle ?? null,
    displayName: raw.displayName ?? null,
    email: raw.email ?? null,
    platformBanned: raw.platformBanned ?? false,
    createdAt: raw.createdAt?.toDate() ?? null,
  };
}

export default function AdminUsersPage() {
  const tAdmin = useTranslations("admin");
  const [tab, setTab] = useState<Tab>("banned");
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Banned users — loaded once when tab = banned
  useEffect(() => {
    if (tab !== "banned") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getDocs(
      query(
        collection(db, "users"),
        where("platformBanned", "==", true),
        orderBy("displayName"),
        limit(100),
      ),
    )
      .then((snap) =>
        setUsers(snap.docs.map((d) => toUserDoc(d.id, d.data() as Record<string, unknown>))),
      )
      .finally(() => setLoading(false));
  }, [tab]);

  // Search — triggered by searchQuery
  useEffect(() => {
    if (tab !== "search") return;
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const term = searchQuery.trim().toLowerCase();
    getDocs(
      query(
        collection(db, "users"),
        orderBy("handle"),
        startAt(term),
        endAt(term + ""),
        limit(30),
      ),
    )
      .then((snap) =>
        setUsers(snap.docs.map((d) => toUserDoc(d.id, d.data() as Record<string, unknown>))),
      )
      .finally(() => setLoading(false));
  }, [tab, searchQuery]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: "#fff" }}>
        Usuarios
      </h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["banned", "search"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setUsers([]); setLoading(t === "banned"); }}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${tab === t ? "#a855f7" : "#2a2a2a"}`,
              background: tab === t ? "#1a0a2a" : "transparent",
              color: tab === t ? "#d8b4fe" : "#666",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t === "banned" ? tAdmin("tabBanned") : tAdmin("tabSearch")}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            type="text"
            placeholder={tAdmin("searchHandlePlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid #2a2a2a",
              background: "#111",
              color: "#fff",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: "none",
              background: "#7c3aed",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {tAdmin("searchButton")}
          </button>
        </form>
      )}

      {loading ? (
        <div style={{ color: "#555", fontSize: 14 }}>{tAdmin("myReportsLoading")}</div>
      ) : users.length === 0 ? (
        <div style={{ color: "#555", fontSize: 14 }}>
          {tab === "banned"
            ? tAdmin("noBannedUsers")
            : searchQuery
            ? "Sin resultados."
            : tAdmin("searchPrompt")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {users.map((u) => (
            <div
              key={u.uid}
              style={{
                background: "#111",
                border: "1px solid #1e1e1e",
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>
                    {u.displayName ?? "Sin nombre"}
                  </span>
                  {u.handle && (
                    <span style={{ fontSize: 12, color: "#666" }}>@{u.handle}</span>
                  )}
                  {u.platformBanned && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#f87171",
                        background: "#1f0a0a",
                        border: "1px solid #7f1d1d",
                        padding: "1px 7px",
                        borderRadius: 4,
                        fontWeight: 600,
                      }}
                    >
                      Bloqueado
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#444", marginTop: 3, fontFamily: "monospace" }}>
                  {u.uid}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
