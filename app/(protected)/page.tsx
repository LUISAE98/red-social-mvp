"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";

type Group = {
  id: string;
  name?: string;
  description?: string;
  visibility?: string;
};

export default function HomePage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  // ✅ NUEVO: para evitar que se muestre el mensaje de /login mientras Firebase aún “resuelve” la sesión
  const [authReady, setAuthReady] = useState(false);

  // ✅ NUEVO: rol/status desde Firestore members/{uid}
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<string | null>(null);

  // 1) Escuchar sesión (Auth)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2) Cargar grupos (Firestore) -> SOLO PUBLICOS
  useEffect(() => {
    async function load() {
      try {
        const q = query(collection(db, "groups"), where("visibility", "==", "public"));
        const snap = await getDocs(q);

        const data: Group[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setGroups(data);
      } catch (e: any) {
        setError(e?.message ?? "Error desconocido leyendo Firestore");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // ✅ 3) Cargar mi membership (members/{uid}) para sacar role/status
  useEffect(() => {
    async function loadMyMembership() {
      if (!user) {
        setMyRole(null);
        setMyStatus(null);
        return;
      }

      const firstGroupId = groups?.[0]?.id;
      if (!firstGroupId) {
        setMyRole(null);
        setMyStatus(null);
        return;
      }

      try {
        const ref = doc(db, "groups", firstGroupId, "members", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setMyRole(null);
          setMyStatus(null);
          return;
        }

        const data = snap.data() as any;
        setMyRole(data.role ?? null);
        setMyStatus(data.status ?? null);
      } catch (e: any) {
        // si algo falla, lo mostramos como error general (sin romper la app)
        setError(e?.message ?? "Error leyendo rol en members");
      }
    }

    loadMyMembership();
  }, [user, groups]);

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Grupos (desde Firestore)</h1>

      {loading && <p>Cargando...</p>}
      {error && (
        <p style={{ color: "red" }}>
          Error: {error}
        </p>
      )}

      {!loading && !error && (
        <ul style={{ marginTop: 16, paddingLeft: 18 }}>
          {groups.map((g) => (
            <li key={g.id} style={{ marginBottom: 10 }}>
              <div>
                <b>{g.name ?? "(sin nombre)"}</b> — <small>{g.visibility ?? "?"}</small>
              </div>
              <div style={{ opacity: 0.8 }}>{g.description ?? ""}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>id: {g.id}</div>
            </li>
          ))}
        </ul>
      )}

      <hr style={{ margin: "24px 0" }} />

      <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, maxWidth: 520 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Mi sesión y rol</h2>
        <p style={{ marginTop: 8 }}>
          Ve a <a href="/login">/login</a> para iniciar sesión.
        </p>
      </section>

      <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, maxWidth: 520 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Mi sesión y rol</h2>

        {/* ✅ CAMBIO: solo mostramos el mensaje “Ve a /login” cuando authReady ya es true */}
        {authReady && !user && (
          <p style={{ marginTop: 8 }}>
            Ve a <a href="/login">/login</a> para iniciar sesión.
          </p>
        )}

        {user && (
          <div style={{ marginTop: 8 }}>
            <p><b>UID:</b> {user.uid}</p>
            <p><b>Email:</b> {user.email}</p>
            <p><b>Rol:</b> {myRole ?? "(sin rol / no es miembro)"}</p>
            <p><b>Status:</b> {myStatus ?? "(n/a)"}</p>
          </div>
        )}
      </section>
    </main>
  );
}
