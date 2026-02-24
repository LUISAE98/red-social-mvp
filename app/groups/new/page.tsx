"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGroup } from "@/lib/groups/createGroup";
import type { GroupVisibility } from "@/types/group";
import { useAuth } from "@/app/providers";

export default function NewGroupPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError("Debes iniciar sesión para crear un grupo.");
      return;
    }

    setLoading(true);
    try {
      const groupId = await createGroup({
        name,
        description,
        ownerId: user.uid,
        visibility,
        imageUrl: null,
      });

      router.push(`/groups/${groupId}`);
    } catch (err: any) {
      setError(err?.message ?? "Error al crear grupo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Crear grupo</h1>

      <form onSubmit={onSubmit} style={{ marginTop: 18, display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Comunidad de X"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
            required
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Descripción</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe de qué trata el grupo..."
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", minHeight: 110 }}
            required
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Visibilidad</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as GroupVisibility)}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          >
            <option value="public">Público</option>
            <option value="private">Privado</option>
            <option value="hidden">Oculto</option>
          </select>
        </label>

        {error && (
          <div style={{ padding: 10, borderRadius: 8, border: "1px solid #f3b4b4", color: "#b00020" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #444" }}
        >
          {loading ? "Creando..." : "Crear grupo"}
        </button>
      </form>
    </main>
  );
}
