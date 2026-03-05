"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { createGroup } from "@/lib/groups/createGroup";
import type { Currency, GroupCategory, GroupVisibility, PostingMode } from "@/types/group";

import { db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";

import { uploadFile } from "@/lib/storage/uploadFile";
import { buildFileName } from "@/lib/storage/fileNaming";
import ImageCropperModal from "@/components/media/ImageCropperModal";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function isAllowedImageType(type: string) {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

function extFromMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB (alineado con rules)
const AVATAR_ASPECT = 1; // 1:1
const COVER_ASPECT = 16 / 9;

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

  // ✅ Storage: Avatar / Cover (final recortado)
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  // Raw file -> abrir cropper
  const [pendingAvatarSrc, setPendingAvatarSrc] = useState<string | null>(null);
  const [pendingCoverSrc, setPendingCoverSrc] = useState<string | null>(null);

  const [cropAvatarOpen, setCropAvatarOpen] = useState(false);
  const [cropCoverOpen, setCropCoverOpen] = useState(false);

  const avatarPreview = useMemo(() => (avatarFile ? URL.createObjectURL(avatarFile) : null), [avatarFile]);
  const coverPreview = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : null), [coverFile]);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
      if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [avatarUploadPct, setAvatarUploadPct] = useState<number>(0);
  const [coverUploadPct, setCoverUploadPct] = useState<number>(0);

  // UX
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/groups/new")}`);
    }
  }, [authLoading, user, router]);

  function validateImageFile(file: File, label: string): string | null {
    if (!isAllowedImageType(file.type)) return `${label}: tipo inválido. Usa JPG, PNG o WEBP.`;
    if (file.size > MAX_IMAGE_BYTES) return `${label}: demasiado grande (máx 5MB).`;
    return null;
  }

  function onPickAvatar(file: File | null) {
    if (!file) return;
    const msg = validateImageFile(file, "Avatar");
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    const src = URL.createObjectURL(file);
    setPendingAvatarSrc(src);
    setCropAvatarOpen(true);
  }

  function onPickCover(file: File | null) {
    if (!file) return;
    const msg = validateImageFile(file, "Portada");
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    const src = URL.createObjectURL(file);
    setPendingCoverSrc(src);
    setCropCoverOpen(true);
  }

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
    setAvatarUploadPct(0);
    setCoverUploadPct(0);

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
        isActive: true,
      });

      let avatarUrl: string | null = null;
      let coverUrl: string | null = null;

      if (avatarFile) {
        const fileName = buildFileName(user.uid, avatarFile.name);
        const path = `groups/${groupId}/avatar/${fileName}`;
        avatarUrl = await uploadFile({
          file: avatarFile,
          path,
          onProgress: (p) => setAvatarUploadPct(Math.round(p)),
        });
      }

      if (coverFile) {
        const fileName = buildFileName(user.uid, coverFile.name);
        const path = `groups/${groupId}/cover/${fileName}`;
        coverUrl = await uploadFile({
          file: coverFile,
          path,
          onProgress: (p) => setCoverUploadPct(Math.round(p)),
        });
      }

      if (avatarUrl || coverUrl) {
        const ref = doc(db, "groups", groupId);
        await updateDoc(ref, {
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(coverUrl ? { coverUrl } : {}),
          updatedAt: Date.now(),
        });
      }

      router.push(`/groups/${groupId}`);
    } catch (err: any) {
      setError(err?.message ?? "Error creando grupo.");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-[60vh] p-6">
        <div className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm text-white/70">Cargando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="p-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold text-white">Crear grupo</h1>
            <p className="text-sm text-white/60">Estilo dark (MVP). Luego pulimos globalmente.</p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {/* Datos base */}
            <section className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Nombre</label>
                <input
                  className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Fans de Alfredo"
                />
              </div>

              <div>
                <label className="block text-xs text-white/60 mb-1">Descripción</label>
                <textarea
                  className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe tu grupo..."
                  rows={4}
                />
              </div>

              <div>
                <label className="block text-xs text-white/60 mb-1">Visibilidad</label>
                <select
                  className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as GroupVisibility)}
                >
                  <option value="public">Público</option>
                  <option value="private">Privado (requiere aprobación)</option>
                  <option value="hidden">Oculto (solo con link)</option>
                </select>
              </div>
            </section>

            {/* Imágenes */}
            <section className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Imágenes</h2>
                <span className="text-xs text-white/50">Avatar 1:1 · Portada 16:9</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Avatar */}
                <div className="space-y-2">
                  <label className="block text-xs text-white/60">Avatar (recortable, máx 5MB)</label>

                  <div className="flex items-center gap-3">
                    <div className="h-16 w-16 rounded-full border border-white/10 bg-black/40 overflow-hidden grid place-items-center">
                      {avatarPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-white/30">Avatar</span>
                      )}
                    </div>

                    <label className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 cursor-pointer">
                      Elegir
                      <input
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
                      />
                    </label>

                    {avatarFile && (
                      <button
                        type="button"
                        onClick={() => setAvatarFile(null)}
                        className="text-xs text-white/50 hover:text-white/80"
                      >
                        Quitar
                      </button>
                    )}
                  </div>

                  {loading && avatarFile && (
                    <p className="text-xs text-white/70">Subiendo avatar: {avatarUploadPct}%</p>
                  )}
                </div>

                {/* Cover */}
                <div className="space-y-2">
                  <label className="block text-xs text-white/60">Portada (recortable, máx 5MB)</label>

                  <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                    {coverPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverPreview} alt="Cover" className="w-full h-32 object-cover" />
                    ) : (
                      <div className="w-full h-32 grid place-items-center text-xs text-white/30">
                        Portada
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 cursor-pointer">
                      Elegir
                      <input
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => onPickCover(e.target.files?.[0] ?? null)}
                      />
                    </label>

                    {coverFile && (
                      <button
                        type="button"
                        onClick={() => setCoverFile(null)}
                        className="text-xs text-white/50 hover:text-white/80"
                      >
                        Quitar
                      </button>
                    )}
                  </div>

                  {loading && coverFile && (
                    <p className="text-xs text-white/70">Subiendo portada: {coverUploadPct}%</p>
                  )}
                </div>
              </div>

              <p className="text-xs text-white/45">
                Aquí ya puedes mover/centrar la imagen antes de subir. Luego esto mismo se reutiliza en “Editar grupo”.
              </p>
            </section>

            {/* Extendidos */}
            <section className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Categoría</label>
                <select
                  className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10"
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
                <label className="block text-xs text-white/60 mb-1">Tags (separados por coma)</label>
                <input
                  className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="ej: comedia, standup, fans"
                />
                <p className="text-xs text-white/45 mt-1">Máximo 10 tags.</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="greetingsEnabled"
                  type="checkbox"
                  checked={greetingsEnabled}
                  onChange={(e) => setGreetingsEnabled(e.target.checked)}
                />
                <label htmlFor="greetingsEnabled" className="text-sm text-white/80">
                  Activar mensaje de bienvenida
                </label>
              </div>

              {greetingsEnabled && (
                <div>
                  <label className="block text-xs text-white/60 mb-1">Mensaje de bienvenida</label>
                  <textarea
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    placeholder="Ej: Bienvenido al grupo..."
                    rows={3}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/60 mb-1">Edad mínima</label>
                  <input
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                    placeholder="18"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Edad máxima</label>
                  <input
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                    placeholder="99"
                  />
                </div>
              </div>
            </section>

            {/* Reglas */}
            <section className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Quién puede publicar</label>
                <select
                  className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10"
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
                <label htmlFor="commentsEnabled" className="text-sm text-white/80">
                  Permitir comentarios
                </label>
              </div>
            </section>

            {/* Monetización */}
            <section className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 space-y-3">
              <h2 className="text-base font-semibold text-white">Monetización</h2>

              {!subscriptionAllowed && (
                <p className="text-xs text-white/50">Nota: los grupos públicos no pueden tener suscripción (MVP).</p>
              )}

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="radio"
                    name="monetizationMode"
                    value="free"
                    checked={monetizationMode === "free"}
                    onChange={() => setMonetizationMode("free")}
                  />
                  Gratis
                </label>

                <label className="flex items-center gap-2 text-sm text-white/80">
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
                    <label className="block text-xs text-white/60 mb-1">Precio mensual</label>
                    <input
                      className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                      value={priceMonthly}
                      onChange={(e) => setPriceMonthly(e.target.value)}
                      placeholder="Ej: 99"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/60 mb-1">Moneda</label>
                    <select
                      className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as Currency)}
                    >
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
              )}
            </section>

            {/* Servicios del creador */}
            <section className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4 space-y-3">
              <h2 className="text-base font-semibold text-white">Servicios del creador (MVP)</h2>

              <div className="grid grid-cols-1 gap-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={sellSaludo} onChange={(e) => setSellSaludo(e.target.checked)} />
                  Vender saludos
                </label>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={sellConsejo} onChange={(e) => setSellConsejo(e.target.checked)} />
                  Vender consejos
                </label>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={sellMensaje} onChange={(e) => setSellMensaje(e.target.checked)} />
                  Vender mensajes
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/60 mb-1">Precio saludo</label>
                  <input
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={saludoPrice}
                    onChange={(e) => setSaludoPrice(e.target.value)}
                    placeholder="Ej: 500"
                    disabled={!sellSaludo}
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Precio consejo</label>
                  <input
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={consejoPrice}
                    onChange={(e) => setConsejoPrice(e.target.value)}
                    placeholder="Ej: 300"
                    disabled={!sellConsejo}
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Precio mensaje</label>
                  <input
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={mensajePrice}
                    onChange={(e) => setMensajePrice(e.target.value)}
                    placeholder="Ej: 150"
                    disabled={!sellMensaje}
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Moneda servicios</label>
                  <select
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10"
                    value={offerCurrency}
                    onChange={(e) => setOfferCurrency(e.target.value as Currency)}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <p className="text-xs text-white/45">
                Nota: por ahora el precio público = precio miembro. Luego habilitamos 2 precios cuando el grupo sea de paga.
              </p>
            </section>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-white text-black font-semibold py-3 hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creando..." : "Crear grupo"}
            </button>
          </form>
        </div>
      </div>

      {/* Cropper: Avatar */}
      <ImageCropperModal
        open={cropAvatarOpen}
        title="Ajustar avatar (círculo)"
        imageSrc={pendingAvatarSrc}
        aspect={AVATAR_ASPECT}
        cropShape="round"
        outputMime="image/jpeg"
        onClose={() => {
          setCropAvatarOpen(false);
          if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
          setPendingAvatarSrc(null);
        }}
        onConfirm={(blob) => {
          if (!user) return;
          const ext = extFromMime("image/jpeg");
          const file = new File([blob], `avatar.${ext}`, { type: "image/jpeg" });
          setAvatarFile(file);

          setCropAvatarOpen(false);
          if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
          setPendingAvatarSrc(null);
        }}
      />

      {/* Cropper: Cover */}
      <ImageCropperModal
        open={cropCoverOpen}
        title="Ajustar portada (16:9)"
        imageSrc={pendingCoverSrc}
        aspect={COVER_ASPECT}
        cropShape="rect"
        outputMime="image/jpeg"
        onClose={() => {
          setCropCoverOpen(false);
          if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
          setPendingCoverSrc(null);
        }}
        onConfirm={(blob) => {
          if (!user) return;
          const ext = extFromMime("image/jpeg");
          const file = new File([blob], `cover.${ext}`, { type: "image/jpeg" });
          setCoverFile(file);

          setCropCoverOpen(false);
          if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
          setPendingCoverSrc(null);
        }}
      />
    </div>
  );
}