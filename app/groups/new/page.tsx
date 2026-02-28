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
  const { user } = useAuth();

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError("Debes iniciar sesión para crear un grupo.");
      return;
    }

    if (name.trim().length < 3) {
      setError("El nombre debe tener al menos 3 caracteres.");
      return;
    }

    if (description.trim().length < 10) {
      setError("La descripción debe tener al menos 10 caracteres.");
      return;
    }

    const ageMinNum = ageMin.trim() === "" ? null : Number(ageMin);
    const ageMaxNum = ageMax.trim() === "" ? null : Number(ageMax);

    if (ageMinNum != null && (ageMinNum < 18 || ageMinNum > 99)) {
      setError("Edad mínima inválida (18–99).");
      return;
    }
    if (ageMaxNum != null && (ageMaxNum < 18 || ageMaxNum > 99)) {
      setError("Edad máxima inválida (18–99).");
      return;
    }
    if (ageMinNum != null && ageMaxNum != null && ageMinNum > ageMaxNum) {
      setError("Edad mínima no puede ser mayor que edad máxima.");
      return;
    }

    const priceNum = priceMonthly.trim() === "" ? null : Number(priceMonthly);
    if (isPaid) {
      if (priceNum == null || !Number.isFinite(priceNum) || priceNum <= 0) {
        setError("Pon un precio mensual válido.");
        return;
      }
    }

    // ✅ Offerings (servicios)
    const sPrice = saludoPrice.trim() === "" ? null : Number(saludoPrice);
    const cPrice = consejoPrice.trim() === "" ? null : Number(consejoPrice);
    const mPrice = mensajePrice.trim() === "" ? null : Number(mensajePrice);

    // Si activan un servicio y ponen precio, debe ser > 0
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
        price: sellSaludo ? sPrice : null,
        currency: sellSaludo ? offerCurrency : null,
      },
      {
        type: "consejo" as const,
        enabled: sellConsejo,
        price: sellConsejo ? cPrice : null,
        currency: sellConsejo ? offerCurrency : null,
      },
      {
        type: "mensaje" as const,
        enabled: sellMensaje,
        price: sellMensaje ? mPrice : null,
        currency: sellMensaje ? offerCurrency : null,
      },
    ].filter((o) => o.enabled);

    setLoading(true);
    try {
      const tags = parseTags(tagsRaw);

      const groupId = await createGroup({
        name,
        description,
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
      });

      router.push(`/groups/${groupId}`);
    } catch (err: any) {
      setError(err?.message ?? "Error al crear grupo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>Crear grupo</h1>

      <form onSubmit={onSubmit} style={{ marginTop: 18, display: "grid", gap: 14 }}>
        {/* ✅ Preview portada + avatar centrado grande */}
        <section style={{ border: "1px solid #eee", borderRadius: 16, overflow: "hidden", background: "#fff" }}>
          <div
            style={{
              height: 170,
              background: "#f2f2f2",
              borderBottom: "1px solid #eee",
              position: "relative",
              display: "grid",
              placeItems: "center",
            }}
            title="Portada (pendiente Firebase Storage)"
          >
            <span style={{ fontSize: 12, color: "#777", fontWeight: 800 }}>PORTADA</span>

            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: -60,
                transform: "translateX(-50%)",
                width: 140,
                height: 140,
                borderRadius: "50%",
                background: "#fff",
                border: "4px solid #fff",
                boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
                display: "grid",
                placeItems: "center",
                fontWeight: 900,
                color: "#666",
              }}
              title="Avatar (pendiente Firebase Storage)"
            >
              FOTO
            </div>
          </div>

          <div style={{ padding: 16, paddingTop: 80 }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              Portada y foto de perfil: <b>pendiente Firebase Storage</b>. Por ahora dejamos el espacio listo.
            </div>
          </div>
        </section>

        {/* Nombre */}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 700 }}>Nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Comunidad de X"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            required
          />
        </label>

        {/* Descripción */}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 700 }}>Descripción</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe de qué trata el grupo..."
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc", minHeight: 110 }}
            required
          />
        </label>

        {/* Visibilidad + categoría */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Visibilidad</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as GroupVisibility)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <option value="public">Público</option>
              <option value="private">Privado</option>
              <option value="hidden">Oculto</option>
            </select>

            <span style={{ fontSize: 12, opacity: 0.7 }}>
              El grupo siempre será visible excepto si eliges <b>Oculto</b>.
            </span>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Categoría</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as GroupCategory)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <optgroup label="Creadores / Artistas">
                <option value="cantante">Cantante</option>
                <option value="musico">Músico</option>
                <option value="banda">Banda</option>
                <option value="comediante">Comediante</option>
                <option value="actor">Actor</option>
                <option value="influencer">Influencer</option>
                <option value="streamer">Streamer</option>
                <option value="youtuber">YouTuber</option>
                <option value="podcaster">Podcaster</option>
                <option value="escritor">Escritor</option>
                <option value="fotografo">Fotógrafo</option>
                <option value="artista_visual">Artista visual</option>
              </optgroup>

              <optgroup label="Gaming / Tecnología">
                <option value="videojuegos">Videojuegos</option>
                <option value="esports">Esports</option>
                <option value="tecnologia">Tecnología</option>
                <option value="programacion">Programación</option>
                <option value="gadgets">Gadgets</option>
                <option value="inteligencia_artificial">Inteligencia Artificial</option>
                <option value="crypto_web3">Crypto / Web3</option>
              </optgroup>

              <optgroup label="Deportes">
                <option value="futbol">Fútbol</option>
                <option value="box">Box</option>
                <option value="fitness">Fitness</option>
                <option value="running">Running</option>
                <option value="deportes_general">Deportes general</option>
              </optgroup>

              <optgroup label="Información / Educación">
                <option value="noticias">Noticias</option>
                <option value="educacion">Educación</option>
                <option value="salud">Salud</option>
                <option value="bienestar">Bienestar</option>
                <option value="finanzas">Finanzas</option>
                <option value="politica">Política</option>
                <option value="negocios">Negocios</option>
                <option value="ciencia">Ciencia</option>
              </optgroup>

              <optgroup label="Lifestyle">
                <option value="moda">Moda</option>
                <option value="belleza">Belleza</option>
                <option value="comida">Comida</option>
                <option value="viajes">Viajes</option>
                <option value="autos">Autos</option>
                <option value="mascotas">Mascotas</option>
                <option value="hobbies">Hobbies</option>
              </optgroup>

              <optgroup label="Institucional">
                <option value="institucion">Institución</option>
                <option value="empresa">Empresa</option>
                <option value="escuela">Escuela</option>
                <option value="gobierno">Gobierno</option>
                <option value="organizacion">Organización</option>
              </optgroup>

              <optgroup label="General">
                <option value="entretenimiento">Entretenimiento</option>
                <option value="otros">Otros</option>
              </optgroup>
            </select>
          </label>
        </div>

        {/* Tags */}
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 700 }}>Tags (separados por comas)</span>
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="Ej. cine, comedia, entrevistas"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
          <span style={{ fontSize: 12, opacity: 0.7 }}>Máximo 10 tags.</span>
        </label>

        {/* Bienvenida */}
        <section style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={greetingsEnabled} onChange={(e) => setGreetingsEnabled(e.target.checked)} />
            <span style={{ fontWeight: 800 }}>Activar mensaje de bienvenida</span>
          </label>

          {greetingsEnabled && (
            <label style={{ display: "grid", gap: 6, marginTop: 10 }}>
              <span style={{ fontWeight: 700 }}>Mensaje</span>
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder="Ej. Bienvenido/a, lee las reglas y preséntate 🙂"
                style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc", minHeight: 90 }}
              />
            </label>
          )}
        </section>

        {/* Edad */}
        <section style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Rango de edad para unirse</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Edad mínima (18–99)</span>
              <input
                type="number"
                value={ageMin}
                onChange={(e) => setAgeMin(e.target.value)}
                min={18}
                max={99}
                style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Edad máxima (18–99)</span>
              <input
                type="number"
                value={ageMax}
                onChange={(e) => setAgeMax(e.target.value)}
                min={18}
                max={99}
                style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              />
            </label>
          </div>
        </section>

        {/* Reglas */}
        <section style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Reglas del grupo</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Quién puede publicar</span>
              <select
                value={postingMode}
                onChange={(e) => setPostingMode(e.target.value as PostingMode)}
                style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              >
                <option value="members">Miembros</option>
                <option value="owner_only">Solo owner</option>
              </select>
            </label>

            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 26 }}>
              <input type="checkbox" checked={commentsEnabled} onChange={(e) => setCommentsEnabled(e.target.checked)} />
              <span style={{ fontWeight: 700 }}>Comentarios habilitados</span>
            </label>
          </div>
        </section>

        {/* Monetización */}
        <section style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Monetización</div>

          {!subscriptionAllowed && (
            <div
              style={{
                fontSize: 13,
                color: "#7a4b00",
                background: "#fff7e6",
                border: "1px solid #ffe1a6",
                padding: 10,
                borderRadius: 12,
              }}
            >
              Para grupos <b>Públicos</b>, la suscripción está desactivada. Si quieres suscripción, elige{" "}
              <b>Privado</b> u <b>Oculto</b>.
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="monetization"
                checked={monetizationMode === "free"}
                onChange={() => setMonetizationMode("free")}
              />
              <b>Gratis</b>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: subscriptionAllowed ? 1 : 0.5 }}>
              <input
                type="radio"
                name="monetization"
                disabled={!subscriptionAllowed}
                checked={monetizationMode === "paid"}
                onChange={() => setMonetizationMode("paid")}
              />
              <b>Con suscripción</b>
            </label>
          </div>

          {isPaid && (
            <>
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Precio mensual</span>
                  <input
                    type="number"
                    value={priceMonthly}
                    onChange={(e) => setPriceMonthly(e.target.value)}
                    placeholder="Ej. 99"
                    min={1}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                    required
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Moneda</span>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
              </div>

              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 12,
                  background: "#fff7e6",
                  border: "1px solid #ffe1a6",
                  fontSize: 13,
                }}
              >
                <b>Importante:</b> hoy solo guardamos la configuración. Para el <b>primer cobro</b> se requerirá{" "}
                <b>KYC</b> (constancia fiscal y datos). Los cobros serán con <b>corte mensual</b>.
              </div>
            </>
          )}
        </section>

        {/* ✅ Servicios del creador */}
        <section style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Servicios del creador</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
            Define qué puede comprar la gente dentro del grupo (MVP: solo configuración + botón; pagos después).
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={sellSaludo} onChange={(e) => setSellSaludo(e.target.checked)} />
              <b>Vender saludos</b>
            </label>
            {sellSaludo && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Precio saludo</span>
                  <input
                    type="number"
                    min={1}
                    value={saludoPrice}
                    onChange={(e) => setSaludoPrice(e.target.value)}
                    placeholder="Ej. 150"
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Moneda</span>
                  <select
                    value={offerCurrency}
                    onChange={(e) => setOfferCurrency(e.target.value as Currency)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
              </div>
            )}

            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={sellConsejo} onChange={(e) => setSellConsejo(e.target.checked)} />
              <b>Vender consejos</b>
            </label>
            {sellConsejo && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Precio consejo</span>
                  <input
                    type="number"
                    min={1}
                    value={consejoPrice}
                    onChange={(e) => setConsejoPrice(e.target.value)}
                    placeholder="Ej. 250"
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Moneda</span>
                  <select
                    value={offerCurrency}
                    onChange={(e) => setOfferCurrency(e.target.value as Currency)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
              </div>
            )}

            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={sellMensaje} onChange={(e) => setSellMensaje(e.target.checked)} />
              <b>Vender mensajes</b>
            </label>
            {sellMensaje && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Precio mensaje</span>
                  <input
                    type="number"
                    min={1}
                    value={mensajePrice}
                    onChange={(e) => setMensajePrice(e.target.value)}
                    placeholder="Ej. 80"
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Moneda</span>
                  <select
                    value={offerCurrency}
                    onChange={(e) => setOfferCurrency(e.target.value as Currency)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </section>

        {error && (
          <div style={{ padding: 10, borderRadius: 10, border: "1px solid #ffd0d0", color: "#b00020" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "11px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            fontWeight: 800,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.75 : 1,
          }}
        >
          {loading ? "Creando..." : "Crear grupo"}
        </button>
      </form>
    </main>
  );
}