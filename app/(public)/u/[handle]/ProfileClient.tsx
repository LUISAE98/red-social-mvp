"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { collection, getDocs, limit, query, where, doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

type UserDoc = {
  uid: string;
  handle: string;
  displayName: string;
  firstName: string;
  lastName: string;
  age: number;
  sex: string;
  photoURL: string | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export default function ProfileClient() {
  const params = useParams<{ handle: string }>();
  const handle = useMemo(() => String(params?.handle || "").toLowerCase(), [params]);

  const [viewer, setViewer] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOwner = !!viewer && !!userDoc && viewer.uid === userDoc.uid;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  async function loadProfile() {
    setLoading(true);
    setMsg(null);
    try {
      // resolver handle -> uid
      const hq = query(collection(db, "handles"), where("__name__", "==", handle), limit(1));
      const hs = await getDocs(hq);
      if (hs.empty) {
        setUserDoc(null);
        setMsg("No existe este usuario.");
        return;
      }
      const hid = hs.docs[0].id;
      const hdata = hs.docs[0].data() as any;
      const uid = hdata?.uid as string;

      if (!uid) {
        setUserDoc(null);
        setMsg("Handle inválido.");
        return;
      }

      const uref = doc(db, "users", uid);
      const usnap = await getDoc(uref);
      if (!usnap.exists()) {
        setUserDoc(null);
        setMsg("Perfil no encontrado.");
        return;
      }

      setUserDoc(usnap.data() as UserDoc);
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando perfil");
      setUserDoc(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!handle) return;
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  async function handlePickFile() {
    if (!isOwner) return;
    fileInputRef.current?.click();
  }

  async function handleUpload(file: File) {
    if (!userDoc) return;
    if (!isOwner) return;

    setUploading(true);
    setMsg(null);

    try {
      const uid = userDoc.uid;

      const avatarRef = ref(storage, `avatars/${uid}`);
      await uploadBytes(avatarRef, file, { contentType: file.type || "image/jpeg" });
      const photoURL = await getDownloadURL(avatarRef);

      const uref = doc(db, "users", uid);
      await updateDoc(uref, { photoURL });

      setUserDoc((prev) => (prev ? { ...prev, photoURL } : prev));
      setMsg("✅ Foto actualizada.");
    } catch (e: any) {
      setMsg(e?.code === "permission-denied"
        ? "❌ Permiso denegado. Revisa reglas de Storage/Firestore."
        : `❌ No se pudo subir la foto: ${e?.message ?? "error"}`);
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>Cargando perfil...</main>;
  }

  if (!userDoc) {
    return <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>{msg ?? "Perfil no disponible"}</main>;
  }

  const fullName = userDoc.displayName || `${userDoc.firstName} ${userDoc.lastName}`.trim();

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ border: "1px solid #e5e5e5", borderRadius: 16, padding: 22 }}>
        {/* Avatar */}
        <div style={{ display: "grid", placeItems: "center", marginTop: 6 }}>
          <div style={{ position: "relative" }}>
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: "50%",
                overflow: "hidden",
                border: "1px solid #ddd",
                display: "grid",
                placeItems: "center",
                background: "#f5f5f5",
                userSelect: "none",
              }}
            >
              {userDoc.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={userDoc.photoURL} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 34, fontWeight: 800, color: "#555" }}>{initials(fullName)}</span>
              )}
            </div>

            {isOwner && (
              <button
                onClick={handlePickFile}
                disabled={uploading}
                style={{
                  position: "absolute",
                  right: -6,
                  bottom: -6,
                  padding: "8px 10px",
                  borderRadius: 999,
                  border: "1px solid #111",
                  background: uploading ? "#ddd" : "#111",
                  color: uploading ? "#333" : "#fff",
                  cursor: uploading ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {uploading ? "Subiendo..." : "Editar"}
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        </div>

        {/* Nombre + handle */}
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{fullName}</div>
          <div style={{ marginTop: 4, color: "#666" }}>@{userDoc.handle}</div>
        </div>

        {/* Info básica */}
        <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#666" }}>Edad</span>
            <b>{userDoc.age}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#666" }}>Sexo</span>
            <b>{userDoc.sex}</b>
          </div>
        </div>

        {msg && <p style={{ marginTop: 16, marginBottom: 0 }}>{msg}</p>}

        {/* Debug sesión */}
        {authReady && viewer && (
          <p style={{ marginTop: 16, opacity: 0.65, fontSize: 12 }}>
            Sesión activa: {viewer.email}
          </p>
        )}
      </div>
    </main>
  );
}