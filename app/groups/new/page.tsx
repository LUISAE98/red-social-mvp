"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { createGroup } from "@/lib/groups/createGroup";
import type { Currency, GroupCategory, GroupVisibility, PostingMode } from "@/types/group";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export default function NewGroupPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Base
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");

  // Extendidos
  const [category, setCategory] = useState<GroupCategory>("otros");
  const [tagsRaw, setTagsRaw] = useState("");

  const [greetingsEnabled, setGreetingsEnabled] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState("");

  // Edad (grupo)
  const [ageMin, setAgeMin] = useState<string>("18");
  const [ageMax, setAgeMax] = useState<string>("99");

  // Reglas
  const [postingMode, setPostingMode] = useState<PostingMode>("members");
  const [commentsEnabled, setCommentsEnabled] = useState(true);

  // Monetización (solo private/hidden)
  const [monetizationMode, setMonetizationMode] = useState<"free" | "paid">("free");
  const [priceMonthly, setPriceMonthly] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("MXN");

  const subscriptionAllowed = visibility !== "public";
  const isPaid = monetizationMode === "paid" && subscriptionAllowed;

  useEffect(() => {
    // Si cambian a public, forzamos gratis
    if (!subscriptionAllowed && monetizationMode === "paid") {
      setMonetizationMode("free");
      setPriceMonthly("");
    }
  }, [subscriptionAllowed, monetizationMode]);

  // ✅ Servicios vendibles (MVP)
  const [sellSaludo, setSellSaludo] = useState(false);
  const [sellConsejo, setSellConsejo] = useState(false);
  const [sellMensaje, setSellMensaje] = useState(false);

  const [saludoPrice, setSaludoPrice] = useState<string>("");
  const [consejoPrice, setConsejoPrice] = useState<string>("");
  const [mensajePrice, setMensajePrice] = useState<string>("");

  const [offerCurrency, setOfferCurrency] = useState<Currency>("MXN");

  // UX
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/groups/new")}`);
    }
  }, [authLoading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError("Debes iniciar sesión.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (trimmedName.length < 3) {
      setError("El nombre debe tener al menos 3 caracteres.");
      return;
    }
    if (trimmedDesc.length < 10) {
      setError("La descripción debe tener al menos 10 caracteres.");
      return;
    }

    // Edad
    const ageMinNum = ageMin ? Number(ageMin) : null;
    const ageMaxNum = ageMax ? Number(ageMax) : null;

    if (ageMinNum != null && (!Number.isFinite(ageMinNum) || ageMinNum < 18 || ageMinNum > 99)) {
      setError("Edad mínima inválida (18–99).");
      return;
    }
    if (ageMaxNum != null && (!Number.isFinite(ageMaxNum) || ageMaxNum < 18 || ageMaxNum > 99)) {
      setError("Edad máxima inválida (18–99).");
      return;
    }
    if (ageMinNum != null && ageMaxNum != null && ageMinNum > ageMaxNum) {
      setError("Edad mínima no puede ser mayor que edad máxima.");
      return;
    }

    // Monetización
    const priceNum = priceMonthly ? Number(priceMonthly) : null;
    if (isPaid) {
      if (priceNum == null || !(priceNum > 0) || !Number.isFinite(priceNum)) {
        setError("Precio mensual inválido.");
        return;
      }
      if (!currency) {
        setError("Selecciona moneda para suscripción.");
        return;
      }
    }

    // Servicios (validación básica)
    const sPrice = saludoPrice ? Number(saludoPrice) : null;
    const cPrice = consejoPrice ? Number(consejoPrice) : null;
    const mPrice = mensajePrice ? Number(mensajePrice) : null;

    if (sellSaludo && sPrice != null && (!(sPrice > 0) || !Number.isFinite(sPrice))) {
      setError("Precio de saludo inválido.");
      return;
    }
    if (sellConsejo && cPrice != null && (!(cPrice > 0) || !Number.isFinite(cPrice))) {
      setError("Precio de consejo inválido.");
      return;
    }
    if (sellMensaje && mPrice != null && (!(mPrice > 0) || !Number.isFinite(mPrice))) {
      setError("Precio de mensaje inválido.");
      return;
    }

    // ✅ UPDATED: offerings con memberPrice/publicPrice (para compilar y soportar schema nuevo)
    // MVP por ahora: publicPrice = memberPrice (luego meteremos UI para diferenciar cuando el grupo sea de paga)
    const offerings = [
      {
        type: "saludo" as const,
        enabled: sellSaludo,
        memberPrice: sellSaludo ? sPrice : null,
        publicPrice: sellSaludo ? sPrice : null,
        currency: sellSaludo ? offerCurrency : null,
      },
      {
        type: "consejo" as const,
        enabled: sellConsejo,
        memberPrice: sellConsejo ? cPrice : null,
        publicPrice: sellConsejo ? cPrice : null,
        currency: sellConsejo ? offerCurrency : null,
      },
      {
        type: "mensaje" as const,
        enabled: sellMensaje,
        memberPrice: sellMensaje ? mPrice : null,
        publicPrice: sellMensaje ? mPrice : null,
        currency: sellMensaje ? offerCurrency : null,
      },
    ].filter((o) => o.enabled);

    setLoading(true);
    try {
      const tags = parseTags(tagsRaw);

      const groupId = await createGroup({
        name: trimmedName,
        description: trimmedDesc,
        ownerId: user.uid,
        visibility,

        discoverable: visibility !== "hidden",

        category,
        tags,

        greetingsEnabled,
        welcomeMessage: greetingsEnabled ? welcomeMessage : null,

        ageMin: ageMinNum,
        ageMax: ageMaxNum,

        // ✅ Storage pendiente
        coverUrl: null,
        avatarUrl: null,

        permissions: {
          postingMode,
          commentsEnabled,
        },

        monetization: {
          isPaid,
          priceMonthly: isPaid ? priceNum : null,
          currency: isPaid ? currency : null,
        },

        offerings,

        imageUrl: null,
        // ✅ FIX
  isActive: true,
      });

      router.push(`/groups/${groupId}`);
    } catch (err: any) {
      setError(err?.message ?? "Error creando grupo.");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto bg-white/5 rounded-xl p-6 border border-white/10">
          <p className="text-sm opacity-80">Cargando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Crear grupo</h1>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Datos base */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <label className="block text-sm mb-1">Nombre</label>
              <input
                className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Fans de Alfredo"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Descripción</label>
              <textarea
                className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe tu grupo..."
                rows={4}
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Visibilidad</label>
              <select
                className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as GroupVisibility)}
              >
                <option value="public">Público</option>
                <option value="private">Privado (requiere aprobación)</option>
                <option value="hidden">Oculto (solo con link)</option>
              </select>
            </div>
          </div>

          {/* Extendidos */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <label className="block text-sm mb-1">Categoría</label>
              <select
                className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                value={category}
                onChange={(e) => setCategory(e.target.value as GroupCategory)}
              >
                <option value="otros">Otros</option>
                <option value="entretenimiento">Entretenimiento</option>
                <option value="influencer">Influencer</option>
                <option value="actor">Actor</option>
                <option value="comediante">Comediante</option>
                <option value="cantante">Cantante</option>
                <option value="youtuber">YouTuber</option>
                <option value="streamer">Streamer</option>
                <option value="podcaster">Podcaster</option>
                <option value="tecnologia">Tecnología</option>
                <option value="videojuegos">Videojuegos</option>
                <option value="fitness">Fitness</option>
                <option value="negocios">Negocios</option>
                <option value="educacion">Educación</option>
                <option value="viajes">Viajes</option>
                <option value="comida">Comida</option>
              </select>
            </div>

            <div>
              <label className="block text-sm mb-1">Tags (separados por coma)</label>
              <input
                className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="ej: comedia, standup, fans"
              />
              <p className="text-xs opacity-60 mt-1">Máximo 10 tags.</p>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="greetingsEnabled"
                type="checkbox"
                checked={greetingsEnabled}
                onChange={(e) => setGreetingsEnabled(e.target.checked)}
              />
              <label htmlFor="greetingsEnabled" className="text-sm">
                Activar mensaje de bienvenida
              </label>
            </div>

            {greetingsEnabled && (
              <div>
                <label className="block text-sm mb-1">Mensaje de bienvenida</label>
                <textarea
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Ej: Bienvenido al grupo..."
                  rows={3}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Edad mínima</label>
                <input
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                  placeholder="18"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Edad máxima</label>
                <input
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
                  placeholder="99"
                />
              </div>
            </div>
          </div>

          {/* Reglas */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <label className="block text-sm mb-1">Quién puede publicar</label>
              <select
                className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                value={postingMode}
                onChange={(e) => setPostingMode(e.target.value as PostingMode)}
              >
                <option value="members">Miembros</option>
                <option value="owner_only">Solo dueño</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="commentsEnabled"
                type="checkbox"
                checked={commentsEnabled}
                onChange={(e) => setCommentsEnabled(e.target.checked)}
              />
              <label htmlFor="commentsEnabled" className="text-sm">
                Permitir comentarios
              </label>
            </div>
          </div>

          {/* Monetización */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <h2 className="text-lg font-medium">Monetización</h2>

            {!subscriptionAllowed && (
              <p className="text-xs opacity-70">
                Nota: los grupos públicos no pueden tener suscripción (MVP).
              </p>
            )}

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="monetizationMode"
                  value="free"
                  checked={monetizationMode === "free"}
                  onChange={() => setMonetizationMode("free")}
                />
                Gratis
              </label>

              <label className="flex items-center gap-2 text-sm opacity-90">
                <input
                  type="radio"
                  name="monetizationMode"
                  value="paid"
                  checked={monetizationMode === "paid"}
                  disabled={!subscriptionAllowed}
                  onChange={() => setMonetizationMode("paid")}
                />
                Suscripción mensual
              </label>
            </div>

            {isPaid && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">Precio mensual</label>
                  <input
                    className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                    value={priceMonthly}
                    onChange={(e) => setPriceMonthly(e.target.value)}
                    placeholder="Ej: 99"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Moneda</label>
                  <select
                    className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Servicios del creador */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <h2 className="text-lg font-medium">Servicios del creador (MVP)</h2>

            <div className="grid grid-cols-1 gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sellSaludo} onChange={(e) => setSellSaludo(e.target.checked)} />
                Vender saludos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sellConsejo} onChange={(e) => setSellConsejo(e.target.checked)} />
                Vender consejos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sellMensaje} onChange={(e) => setSellMensaje(e.target.checked)} />
                Vender mensajes
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Precio saludo</label>
                <input
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={saludoPrice}
                  onChange={(e) => setSaludoPrice(e.target.value)}
                  placeholder="Ej: 500"
                  disabled={!sellSaludo}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Precio consejo</label>
                <input
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={consejoPrice}
                  onChange={(e) => setConsejoPrice(e.target.value)}
                  placeholder="Ej: 300"
                  disabled={!sellConsejo}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Precio mensaje</label>
                <input
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={mensajePrice}
                  onChange={(e) => setMensajePrice(e.target.value)}
                  placeholder="Ej: 150"
                  disabled={!sellMensaje}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Moneda servicios</label>
                <select
                  className="w-full rounded-lg bg-black/40 border border-white/10 p-2"
                  value={offerCurrency}
                  onChange={(e) => setOfferCurrency(e.target.value as Currency)}
                >
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            <p className="text-xs opacity-70">
              Nota: por ahora el precio público = precio miembro. En el siguiente paso habilitamos 2 precios cuando el
              grupo sea de paga.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white text-black font-medium py-3 disabled:opacity-50"
          >
            {loading ? "Creando..." : "Crear grupo"}
          </button>
        </form>
      </div>
    </div>
  );
}