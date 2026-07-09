"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useTranslations } from "next-intl";
import { auth, db } from "@/lib/firebase";
import { uploadFile } from "@/lib/storage/uploadFile";

type AdminProfile = {
  avatarUrl?: string | null;
};

export default function AdminProfilePage() {
  const tAdmin = useTranslations("admin");
  const [viewer, setViewer] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setViewer(u);
      if (!u) { setLoading(false); return; }

      try {
        const snap = await getDoc(doc(db, "adminProfiles", u.uid));
        setProfile(snap.exists() ? (snap.data() as AdminProfile) : {});
      } catch {
        setProfile({});
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !viewer) return;

    setError(null);
    setUploading(true);
    setUploadProgress(0);

    try {
      const path = `users/${viewer.uid}/avatar/admin.jpg`;
      const url = await uploadFile({ file, path, onProgress: setUploadProgress });

      await setDoc(
        doc(db, "adminProfiles", viewer.uid),
        { avatarUrl: url },
        { merge: true }
      );
      setProfile((prev) => ({ ...prev, avatarUrl: url }));
    } catch (err: unknown) {
      setError(
        (err instanceof Error ? err.message : null) ?? tAdmin("uploadImageError")
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div style={{ color: "#444", fontSize: 13, paddingTop: 8 }}>
        {tAdmin("loadingProfile")}
      </div>
    );
  }

  if (!viewer) return null;

  const avatarUrl = profile?.avatarUrl ?? null;
  const uid = viewer.uid;
  const email = viewer.email ?? "—";
  const createdAt = viewer.metadata.creationTime
    ? new Date(viewer.metadata.creationTime).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  const initials = (email[0] ?? "A").toUpperCase();

  return (
    <>
      <style jsx>{`
        .section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #444;
          margin-bottom: 6px;
        }
        .field-box {
          background: #0f0f0f;
          border: 1px solid #1e1e1e;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 12.5px;
          color: #aaa;
          word-break: break-all;
          line-height: 1.4;
          font-family: "SF Mono", "Fira Code", monospace;
        }
        .field-box.mono {
          color: #888;
          font-size: 11px;
        }
      `}</style>

      <div style={{ display: "grid", gap: 24, maxWidth: 320 }}>

        {/* Avatar */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div className="section-label">Avatar</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Avatar circle */}
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                overflow: "hidden",
                background: "#1a1a1a",
                border: "1px solid #2a2a2a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                position: "relative",
              }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontSize: 22, fontWeight: 700, color: "#555" }}>
                  {initials}
                </span>
              )}
              {uploading && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0,0,0,0.7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  {Math.round(uploadProgress)}%
                </div>
              )}
            </div>

            {/* Upload button */}
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: "7px 14px",
                borderRadius: 7,
                border: "1px solid #2a2a2a",
                background: "#111",
                color: uploading ? "#444" : "#aaa",
                fontSize: 12,
                fontWeight: 600,
                cursor: uploading ? "not-allowed" : "pointer",
                transition: "border-color 150ms, color 150ms",
              }}
              onMouseEnter={(e) => {
                if (!uploading) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#444";
                  (e.currentTarget as HTMLButtonElement).style.color = "#fff";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a2a";
                (e.currentTarget as HTMLButtonElement).style.color = uploading ? "#444" : "#aaa";
              }}
            >
              {uploading ? `Subiendo ${Math.round(uploadProgress)}%` : "Cambiar foto"}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleAvatarSelect}
            />
          </div>

          {error && (
            <div
              style={{
                fontSize: 11.5,
                color: "#f87171",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.18)",
                borderRadius: 6,
                padding: "6px 10px",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* UID */}
        <div>
          <div className="section-label">UID</div>
          <div className="field-box mono">{uid}</div>
        </div>

        {/* Email */}
        <div>
          <div className="section-label">Correo</div>
          <div className="field-box">{email}</div>
        </div>

        {/* Fecha de creación */}
        <div>
          <div className="section-label">Cuenta creada</div>
          <div className="field-box">{createdAt}</div>
        </div>

      </div>
    </>
  );
}
