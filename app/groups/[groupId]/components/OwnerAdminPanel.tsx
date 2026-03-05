"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { updateDoc, doc } from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { cropImageToBlob, type CropPixels } from "@/lib/storage/cropImage";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;

  currentAvatarUrl?: string | null;
  currentCoverUrl?: string | null;

  currentName?: string | null;
  currentDescription?: string | null;
  currentCategory?: string | null;
  currentTags?: string[] | null;
};

type TabKey = "general" | "images" | "status";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

type CropModalProps = {
  open: boolean;
  src: string | null;
  aspect: number;
  round?: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
};

function CropModal({ open, src, aspect, round, title, onClose, onConfirm }: CropModalProps) {
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropPixels | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setBusy(false);
    setErr(null);
  }, [open, src]);

  if (!open || !src) return null;

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalCard}>
        <div style={styles.modalHeader}>
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button style={styles.iconBtn} onClick={onClose} type="button" aria-label="Cerrar" disabled={busy}>
            ✕
          </button>
        </div>

        <div
          style={{
            position: "relative",
            width: "100%",
            height: 360,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            overflow: "hidden",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape={round ? "round" : "rect"}
            showGrid={!round}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels as CropPixels)}
          />
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 800, width: 50 }}>Zoom</div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: "100%" }}
              disabled={busy}
            />
          </div>

          {err && <div style={styles.err}>{err}</div>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={styles.btnGhost} type="button" onClick={onClose} disabled={busy}>
              Cancelar
            </button>

            <button
              style={styles.btnPrimary}
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  setErr(null);
                  setBusy(true);

                  if (!croppedAreaPixels) {
                    setErr("No se detectó el área de recorte. Mueve/zoom a la imagen y vuelve a intentar.");
                    return;
                  }

                  // ✅ TU helper real de recorte
                  const blob = await cropImageToBlob(src, croppedAreaPixels, "image/jpeg", 0.92);

                  await onConfirm(blob);
                } catch (e: any) {
                  setErr(e?.message ?? "No se pudo recortar la imagen.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Recortando..." : "Usar"}
            </button>
          </div>

          <div style={{ fontSize: 12, opacity: 0.7 }}>Tip: mueve la imagen y usa zoom para encuadrar.</div>
        </div>
      </div>
    </div>
  );
}

export default function OwnerAdminPanel(props: Props) {
  const {
    groupId,
    ownerId,
    currentUserId,
    currentAvatarUrl = null,
    currentCoverUrl = null,
    currentName = "",
    currentDescription = "",
    currentCategory = null,
    currentTags = null,
  } = props;

  const isOwner = useMemo(() => ownerId === currentUserId, [ownerId, currentUserId]);
  if (!isOwner) return null;

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("general");

  // ✅ Panel fijo para evitar brincos visuales entre tabs
  const PANEL_WIDTH = 520;
  const PANEL_MIN_HEIGHT = 420;

  // General
  const [name, setName] = useState(currentName ?? "");
  const [description, setDescription] = useState(currentDescription ?? "");
  const [category, setCategory] = useState(currentCategory ?? "otros");
  const [tagsRaw, setTagsRaw] = useState((currentTags ?? []).join(", "));
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [generalErr, setGeneralErr] = useState<string | null>(null);

  // Images
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentAvatarUrl);
  const [coverUrl, setCoverUrl] = useState<string | null>(currentCoverUrl);
  const [savingImages, setSavingImages] = useState(false);
  const [imagesMsg, setImagesMsg] = useState<string | null>(null);
  const [imagesErr, setImagesErr] = useState<string | null>(null);

  // ✅ Inputs refs para poder re-seleccionar imágenes sin cerrar panel
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Crop state
  const [cropAvatarOpen, setCropAvatarOpen] = useState(false);
  const [cropCoverOpen, setCropCoverOpen] = useState(false);
  const [pendingAvatarSrc, setPendingAvatarSrc] = useState<string | null>(null);
  const [pendingCoverSrc, setPendingCoverSrc] = useState<string | null>(null);

  // Status
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // Al abrir panel, sincroniza valores actuales (sin pisar cuando está cerrado)
  useEffect(() => {
    if (!open) return;

    setName(currentName ?? "");
    setDescription(currentDescription ?? "");
    setCategory(currentCategory ?? "otros");
    setTagsRaw((currentTags ?? []).join(", "));

    setAvatarUrl(currentAvatarUrl ?? null);
    setCoverUrl(currentCoverUrl ?? null);

    setGeneralMsg(null);
    setGeneralErr(null);
    setImagesMsg(null);
    setImagesErr(null);
    setStatusMsg(null);
    setStatusErr(null);
  }, [open, currentName, currentDescription, currentCategory, currentTags, currentAvatarUrl, currentCoverUrl]);

  function cleanupObjectUrls() {
    if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
    if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
    setPendingAvatarSrc(null);
    setPendingCoverSrc(null);
  }

  function closePanel() {
    setOpen(false);
    setTab("general");

    setCropAvatarOpen(false);
    setCropCoverOpen(false);
    cleanupObjectUrls();

    // limpia inputs
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  async function saveGeneral() {
    setSavingGeneral(true);
    setGeneralMsg(null);
    setGeneralErr(null);

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (trimmedName.length < 3) {
      setSavingGeneral(false);
      setGeneralErr("El nombre debe tener al menos 3 caracteres.");
      return;
    }
    if (trimmedDesc.length < 10) {
      setSavingGeneral(false);
      setGeneralErr("La descripción debe tener al menos 10 caracteres.");
      return;
    }

    const tags = parseTags(tagsRaw);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        name: trimmedName,
        description: trimmedDesc,
        category: category ?? "otros",
        tags,
        updatedAt: Date.now(),
      });
      setGeneralMsg("✅ Cambios guardados.");
    } catch (e: any) {
      setGeneralErr(e?.message ?? "No se pudieron guardar cambios.");
    } finally {
      setSavingGeneral(false);
    }
  }

  function pickAvatar(file: File | null) {
    setImagesMsg(null);
    setImagesErr(null);
    if (!file) return;

    const url = URL.createObjectURL(file);
    if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
    setPendingAvatarSrc(url);
    setCropAvatarOpen(true);
  }

  function pickCover(file: File | null) {
    setImagesMsg(null);
    setImagesErr(null);
    if (!file) return;

    const url = URL.createObjectURL(file);
    if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
    setPendingCoverSrc(url);
    setCropCoverOpen(true);
  }

  async function uploadToStorage(path: string, blob: Blob): Promise<string> {
    const r = sRef(storage, path);
    await uploadBytes(r, blob, { contentType: blob.type || "image/jpeg" });
    return await getDownloadURL(r);
  }

  async function confirmAvatarCrop(blob: Blob) {
    setSavingImages(true);
    setImagesMsg(null);
    setImagesErr(null);

    try {
      const filename = `avatar_${Date.now()}.jpg`;
      const path = `groups/${groupId}/avatar/${filename}`;
      const url = await uploadToStorage(path, blob);

      setAvatarUrl(url);
      setImagesMsg("✅ Avatar listo. Guarda para aplicar.");

      // cerrar + limpiar
      setCropAvatarOpen(false);
      if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
      setPendingAvatarSrc(null);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    } catch (e: any) {
      setImagesErr(e?.message ?? "No se pudo subir el avatar.");
    } finally {
      setSavingImages(false);
    }
  }

  async function confirmCoverCrop(blob: Blob) {
    setSavingImages(true);
    setImagesMsg(null);
    setImagesErr(null);

    try {
      const filename = `cover_${Date.now()}.jpg`;
      const path = `groups/${groupId}/cover/${filename}`;
      const url = await uploadToStorage(path, blob);

      setCoverUrl(url);
      setImagesMsg("✅ Portada lista. Guarda para aplicar.");

      // cerrar + limpiar
      setCropCoverOpen(false);
      if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
      setPendingCoverSrc(null);
      if (coverInputRef.current) coverInputRef.current.value = "";
    } catch (e: any) {
      setImagesErr(e?.message ?? "No se pudo subir la portada.");
    } finally {
      setSavingImages(false);
    }
  }

  async function saveImages() {
    setSavingImages(true);
    setImagesMsg(null);
    setImagesErr(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        avatarUrl: avatarUrl ?? null,
        coverUrl: coverUrl ?? null,
        updatedAt: Date.now(),
      });
      setImagesMsg("✅ Imágenes guardadas.");
    } catch (e: any) {
      setImagesErr(e?.message ?? "No se pudieron guardar imágenes.");
    } finally {
      setSavingImages(false);
    }
  }

  async function setActive(isActive: boolean) {
    setStatusBusy(true);
    setStatusMsg(null);
    setStatusErr(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        isActive,
        updatedAt: Date.now(),
      });
      setStatusMsg(isActive ? "✅ Grupo reactivado." : "✅ Grupo pausado.");
    } catch (e: any) {
      setStatusErr(e?.message ?? "No se pudo actualizar el estado.");
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Botón: cerrado -> Administrar | abierto -> ✕ */}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={styles.adminBtn}>
          Administrar <span style={{ opacity: 0.8 }}>⚙️</span>
        </button>
      ) : (
        <button type="button" onClick={closePanel} style={styles.closeFloating} aria-label="Cerrar panel">
          ✕
        </button>
      )}

      {open && (
        <div style={{ ...styles.panel, width: PANEL_WIDTH, minHeight: PANEL_MIN_HEIGHT }}>
          {/* Tabs */}
          <div style={styles.tabs}>
            <button
              type="button"
              onClick={() => setTab("general")}
              style={{ ...styles.tab, ...(tab === "general" ? styles.tabActive : {}) }}
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setTab("images")}
              style={{ ...styles.tab, ...(tab === "images" ? styles.tabActive : {}) }}
            >
              Imágenes
            </button>
            <button
              type="button"
              onClick={() => setTab("status")}
              style={{ ...styles.tab, ...(tab === "status" ? styles.tabActive : {}) }}
            >
              Pausar / Baja
            </button>
          </div>

          {/* Body fijo */}
          <div style={{ ...styles.panelBody, minHeight: PANEL_MIN_HEIGHT - 64 }}>
            {tab === "general" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={styles.field}>
                  <div style={styles.label}>Nombre</div>
                  <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div style={styles.field}>
                  <div style={styles.label}>Descripción</div>
                  <textarea
                    style={{ ...styles.input, minHeight: 92, resize: "vertical" }}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div style={styles.field}>
                  <div style={styles.label}>Categoría</div>
                  <select style={styles.input} value={category ?? "otros"} onChange={(e) => setCategory(e.target.value)}>
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

                <div style={styles.field}>
                  <div style={styles.label}>Tags (coma)</div>
                  <input style={styles.input} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
                  <div style={styles.help}>Máximo 10 tags. Se guardan como array.</div>
                </div>

                {generalErr && <div style={styles.err}>{generalErr}</div>}
                {generalMsg && <div style={styles.ok}>{generalMsg}</div>}

                <button type="button" onClick={saveGeneral} disabled={savingGeneral} style={styles.btnPrimaryWide}>
                  {savingGeneral ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            )}

            {tab === "images" && (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {/* Avatar */}
                  <div style={styles.cardMini}>
                    <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>Avatar (1:1)</div>

                    <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
                      <div style={styles.avatarPreview}>
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : null}
                      </div>

                      <div>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            // ✅ CRÍTICO: reset para permitir elegir otra imagen sin cerrar panel
                            e.target.value = "";
                            pickAvatar(f);
                          }}
                        />

                        <button
                          type="button"
                          style={styles.btnGhost}
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={savingImages}
                        >
                          Elegir
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Cover */}
                  <div style={styles.cardMini}>
                    <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>Portada (16:9)</div>

                    <div style={{ marginTop: 10 }}>
                      <div style={styles.coverPreview}>
                        {coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={coverUrl} alt="cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : null}
                      </div>

                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          // ✅ CRÍTICO: reset
                          e.target.value = "";
                          pickCover(f);
                        }}
                      />

                      <button
                        type="button"
                        style={{ ...styles.btnGhost, marginTop: 10 }}
                        onClick={() => coverInputRef.current?.click()}
                        disabled={savingImages}
                      >
                        Elegir
                      </button>
                    </div>
                  </div>
                </div>

                {imagesErr && <div style={styles.err}>{imagesErr}</div>}
                {imagesMsg && <div style={styles.ok}>{imagesMsg}</div>}

                <button type="button" onClick={saveImages} disabled={savingImages} style={styles.btnPrimaryWide}>
                  {savingImages ? "Guardando..." : "Guardar imágenes"}
                </button>

                <div style={styles.help}>
                  Se recorta antes de subir (avatar círculo y portada 16:9), luego se guarda URL en Firestore.
                </div>

                {/* Modales crop */}
                <CropModal
                  open={cropAvatarOpen}
                  src={pendingAvatarSrc}
                  aspect={1}
                  round
                  title="Recortar avatar"
                  onClose={() => {
                    setCropAvatarOpen(false);
                    if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
                    setPendingAvatarSrc(null);
                    if (avatarInputRef.current) avatarInputRef.current.value = "";
                  }}
                  onConfirm={confirmAvatarCrop}
                />

                <CropModal
                  open={cropCoverOpen}
                  src={pendingCoverSrc}
                  aspect={16 / 9}
                  title="Recortar portada"
                  onClose={() => {
                    setCropCoverOpen(false);
                    if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
                    setPendingCoverSrc(null);
                    if (coverInputRef.current) coverInputRef.current.value = "";
                  }}
                  onConfirm={confirmCoverCrop}
                />
              </div>
            )}

            {tab === "status" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  Pausar un grupo lo marca como inactivo (soft). No borra contenido.
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button type="button" style={styles.btnGhost} onClick={() => setActive(false)} disabled={statusBusy}>
                    {statusBusy ? "..." : "Pausar"}
                  </button>
                  <button type="button" style={styles.btnPrimary} onClick={() => setActive(true)} disabled={statusBusy}>
                    {statusBusy ? "..." : "Reactivar"}
                  </button>
                </div>

                {statusErr && <div style={styles.err}>{statusErr}</div>}
                {statusMsg && <div style={styles.ok}>{statusMsg}</div>}

                <div style={styles.help}>
                  Más adelante podemos agregar confirmación fuerte y motivo/auditoría para “dar de baja”.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  adminBtn: {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  closeFloating: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    marginTop: 12,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10,10,12,0.92)",
    boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
    padding: 14,
  },
  tabs: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  tab: {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    opacity: 0.9,
  },
  tabActive: {
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.85)",
    opacity: 1,
  },
  panelBody: {
    marginTop: 12,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.35)",
    padding: 14,
  },
  field: {
    display: "grid",
    gap: 6,
  },
  label: {
    fontSize: 12,
    opacity: 0.85,
    fontWeight: 900,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
  },
  help: {
    fontSize: 12,
    opacity: 0.7,
  },
  btnPrimaryWide: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.85)",
    background: "#fff",
    color: "#000",
    fontWeight: 900,
    cursor: "pointer",
    width: "100%",
  },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.85)",
    background: "#fff",
    color: "#000",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnGhost: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  cardMini: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 12,
  },
  avatarPreview: {
    width: 46,
    height: 46,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    overflow: "hidden",
    background: "rgba(255,255,255,0.04)",
  },
  coverPreview: {
    width: "100%",
    height: 110,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    overflow: "hidden",
    background: "rgba(255,255,255,0.04)",
  },
  ok: {
    color: "#55efc4",
    fontSize: 13,
    fontWeight: 800,
  },
  err: {
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: 800,
  },
  iconBtn: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    zIndex: 9999,
  },
  modalCard: {
    width: "min(620px, 94vw)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10,10,12,0.96)",
    padding: 14,
    color: "#fff",
    boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
};