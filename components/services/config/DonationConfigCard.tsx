"use client";

// Card de configuración de DONACIÓN — COMPARTIDA entre perfil y comunidad.
//
// Es el mismo formulario (mensaje, 4 montos sugeridos, video de presentación) y los
// mismos estados (antes/durante/después) en ambos lados. Lo único que cambia por
// `scope` es el callable de subida de video y la colección que se escucha para el
// playbackId. Antes esto estaba duplicado (ProfileDonation.tsx vs owner-admin Donation.tsx).
//
// Las strings usan el namespace "profile" (genéricas: sirven igual para comunidad);
// las palabras de entidad (perfil/comunidad) salen de "services" vía publishSuccess.entityKind.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import ServiceInfoIcon from "@/components/services/ServiceInfoIcon";
import ServicePreviewReveal from "@/components/services/ServicePreviewReveal";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";
import ServicePublishedSuccess from "@/components/services/ServicePublishedSuccess";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import {
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  normalizeSuggestedAmounts,
} from "@/components/services/config/serviceConfigKit";

// Cada monto sugerido debe ser al menos este valor (MXN).
const DONATION_MIN_PER_AMOUNT = 50;

type Currency = "MXN" | "USD";
type DonationMode = "none" | "general" | "wedding";

type DonationFields = {
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationSuggestedAmounts: string[];
  donationMessage: string;
  donationVideoUrl: string;
  donationPlaybackId: string;
};

type AnyDraft = DonationFields & Record<string, unknown>;

type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  activeColor?: string;
};

type ModeButtonProps = {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

type OverlayModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  hideFooter?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  draft: AnyDraft;
  saving: boolean;
  /** "profile" → users/{id} + createMuxDonationUpload; "group" → groups/{id} + createMuxGroupDonationUpload. */
  scope: "profile" | "group";
  /** id de la entidad dueña de la donación (profileUserId o groupId). */
  entityId: string;
  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  descriptionStyle?: React.CSSProperties;
  /** Color de acento (vino); activa el ícono info y oculta el emoji cuando está inactivo. */
  accentColor?: string;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;
  SwitchComponent: React.ComponentType<SwitchProps>;
  DonationModeButtonComponent: React.ComponentType<ModeButtonProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  /** Si se provee, al publicar con éxito muestra la vista de éxito (no cierra). */
  publishSuccess?: { shareUrl: string; entityKind: "profile" | "community" };
  onSaveDraft: (nextDraft: AnyDraft) => Promise<boolean | void>;
};

type OverlayMode = null | "activate" | "edit";

const VIDEO_MAX_SECONDS = 300; // 5 minutes

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });
}

export default function DonationConfigCard({
  draft,
  saving,
  scope,
  entityId,
  panelStyle,
  titleStyle,
  subtleStyle,
  descriptionStyle,
  accentColor,
  inputStyle,
  buttonSecondaryStyle,
  SwitchComponent,
  DonationModeButtonComponent,
  OverlayModalComponent,
  publishSuccess,
  onSaveDraft,
}: Props) {
  const tProfile = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const { format: formatMoney, currency: displayCurrency } = usePriceFormat();

  // Diferenciadores por scope (lo único que cambia entre perfil y comunidad).
  const videoCallableName = scope === "group" ? "createMuxGroupDonationUpload" : "createMuxDonationUpload";
  const entityCollection = scope === "group" ? "groups" : "users";

  const isEnabled = draft.donationMode !== "none";

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<AnyDraft>(draft);
  // Vista de éxito tras publicar (panel abierto, sin formulario).
  const [published, setPublished] = useState(false);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPending, setUploadPending] = useState(false); // uploaded but playbackId not yet arrived
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const playbackListenerRef = useRef<(() => void) | null>(null);

  // Clean up any pending playbackId listener on unmount
  useEffect(() => {
    return () => { playbackListenerRef.current?.(); };
  }, []);

  const isBusy = saving || uploadProgress !== null;

  function buildEnabledDraft(base: AnyDraft): AnyDraft {
    return {
      ...base,
      donationMode: base.donationMode === "none" ? "general" : base.donationMode,
    };
  }

  function buildDisabledDraft(base: AnyDraft): AnyDraft {
    return {
      ...base,
      donationMode: "none",
      donationSuggestedAmounts: [...DEFAULT_DONATION_SUGGESTED_AMOUNTS],
      donationMessage: "",
    };
  }

  function stopPlaybackListener() {
    playbackListenerRef.current?.();
    playbackListenerRef.current = null;
  }

  function openOverlay(mode: OverlayMode, next?: AnyDraft) {
    stopPlaybackListener();
    const src = next ?? draft;
    // Cargar los 4 montos sugeridos guardados (MXN crudo) en los inputs; si no
    // hay o vienen incompletos, se rellenan con los defaults [50,120,250,490].
    const shown = normalizeSuggestedAmounts(src.donationSuggestedAmounts);
    setPublished(false);
    setOverlayMode(mode);
    setOverlayDraft({ ...src, donationSuggestedAmounts: shown });
    setUploadErr(null);
    setUploadPending(false);
  }

  function closeOverlay() {
    if (isBusy) return;
    stopPlaybackListener();
    setPublished(false);
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function confirmOverlaySave() {
    if (isBusy) return;
    setSaveErr(null);

    const amounts = (overlayDraft.donationSuggestedAmounts as string[]) ?? [];
    const amountsNum = amounts.map((s) => Number(s));
    if (
      amountsNum.length !== 4 ||
      amountsNum.some((n) => !Number.isFinite(n) || n < DONATION_MIN_PER_AMOUNT)
    ) {
      setSaveErr(tProfile("donationInvalidAmount"));
      return;
    }

    // El video es OPCIONAL (así lo dice la UI). No se exige para publicar.
    if (!(overlayDraft.donationMessage as string).trim()) {
      setSaveErr(tProfile("donationNoMessage"));
      return;
    }
    if ((overlayDraft.donationMessage as string).trim().length > 160) {
      setSaveErr(tProfile("donationMessageTooLong"));
      return;
    }

    // Se guardan los 4 montos CRUDOS en MXN (sin round-trip a ancla USD).
    const toSave: AnyDraft = {
      ...overlayDraft,
      donationSuggestedAmounts: amountsNum.map((n) => String(n)),
      donationCurrency: "MXN",
    };

    const ok = await onSaveDraft(toSave);
    stopPlaybackListener();
    if (ok && publishSuccess?.shareUrl) {
      setPublished(true);
    } else {
      setOverlayMode(null);
    }
  }

  async function handleToggle(next: boolean) {
    if (isBusy) return;
    if (!isEnabled && next) {
      openOverlay("activate", buildEnabledDraft(draft));
      return;
    }
    if (isEnabled && !next) {
      await onSaveDraft(buildDisabledDraft(draft));
    }
  }

  function handleModify() {
    if (isBusy) return;
    openOverlay("edit", buildEnabledDraft(draft));
  }

  async function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);
    setUploadPending(false);

    // Validate duration
    const duration = await getVideoDuration(file);
    if (duration > VIDEO_MAX_SECONDS) {
      setUploadErr(tProfile("donationVideoTooLong", { duration: Math.round(duration) }));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadProgress(0);

    try {
      // 1. Get Mux upload URL from Cloud Function (según scope)
      const callable = httpsCallable<Record<string, string>, { uploadId: string; uploadUrl: string }>(
        functions,
        videoCallableName
      );
      const callableArg: Record<string, string> = scope === "group" ? { groupId: entityId } : { profileId: entityId };
      const result = await callable(callableArg);
      const { uploadUrl, uploadId } = result.data;

      // 2. PUT file to Mux with XHR for progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.onprogress = (ev) => {
          if (ev.total > 0) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(tProfile("donationUploadFailed", { status: xhr.status })));
        };
        xhr.onerror = () => { xhrRef.current = null; reject(new Error(tProfile("donationNetworkError"))); };
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.send(file);
      });

      // 3. Upload done — mark pending and listen for webhook to write playbackId
      setOverlayDraft((p) => ({ ...p, donationVideoUrl: `mux://uploads/${uploadId}` }));
      setUploadPending(true);

      // Real-time listener: when webhook updates donation.playbackId, capture it in the draft
      stopPlaybackListener();
      const unsub = onSnapshot(doc(db, entityCollection, entityId), (snap) => {
        const playbackId = snap.data()?.donation?.playbackId;
        if (typeof playbackId === "string" && playbackId) {
          setOverlayDraft((p) => ({ ...p, donationPlaybackId: playbackId }));
          setUploadPending(false);
          stopPlaybackListener();
        }
      });
      playbackListenerRef.current = unsub;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : tProfile("donationUploadDefault");
      setUploadErr(msg);
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function renderSummary() {
    if (!isEnabled) return null;
    const amountsList = normalizeSuggestedAmounts(draft.donationSuggestedAmounts);
    const amount = amountsList
      .map((a) => formatMoney(Number(a), { baseCurrency: displayCurrency }))
      .join(" · ");
    const hasVideo = Boolean(draft.donationPlaybackId);

    return (
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        {/* Izquierda: estado del video y botón Modificar (texto plano, azul celeste). */}
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subtleStyle}>{tProfile("donationPresentationVideo")}</div>
            <div style={{ color: hasVideo ? "#a3e635" : "rgba(255,255,255,0.4)", fontSize: 13 }}>
              {hasVideo ? tProfile("donationVideoReady") : tProfile("donationNoVideoStatus")}
            </div>
          </div>

          <button
            type="button"
            onClick={handleModify}
            disabled={isBusy}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              justifySelf: "flex-start",
              color: "#7dd3fc",
              fontSize: 14,
              fontWeight: 600,
              cursor: isBusy ? "not-allowed" : "pointer",
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            {tProfile("editLabel")}
          </button>
        </div>

        {/* Esquina inferior derecha: montos programados con el formato de precio de
            los demás servicios, pero más pequeños y en azul celeste para que quepan
            los cuatro. */}
        {amount && (
          <div style={{ display: "grid", gap: 2, justifyItems: "end", textAlign: "end", flexShrink: 0, minWidth: 0 }}>
            <div style={subtleStyle}>Cantidades predeterminadas</div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", flexWrap: "wrap", gap: 6 }}>
              <span
                style={{
                  color: "#7dd3fc",
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: 1.25,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "end",
                }}
              >
                {amount}
              </span>
              <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>+ 3 MXN</span>
            </div>
            <div style={{ ...subtleStyle, textAlign: "end", marginTop: 2 }}>
              Por cada donación cobrarás el 75% del monto configurado
            </div>
          </div>
        )}
      </div>
    );
  }

  // Resolved playbackId — either from saved draft or already uploaded in this session but pending
  const savedPlaybackId = draft.donationPlaybackId as string;
  const overlayPlaybackId = overlayDraft.donationPlaybackId as string;

  // Estados del flujo de subida del video de donación:
  //  - isUploadingVideo: subiendo (0–100) o procesando en Mux → "Subiendo tu video..."
  //  - videoReady: ya hay video listo → "Tu video está listo..."
  //  - (ninguno): estado inicial → invitación a subir
  const isUploadingVideo = uploadProgress !== null || uploadPending;
  const videoReady = Boolean(overlayPlaybackId || savedPlaybackId);

  // Solo se puede publicar la experiencia cuando están los tres requisitos:
  // mensaje, monto mínimo válido y video listo (y no se está subiendo).
  const overlayAmounts = (overlayDraft.donationSuggestedAmounts as string[]) ?? [];
  const overlayAmountsValid =
    overlayAmounts.length === 4 &&
    overlayAmounts.every((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= DONATION_MIN_PER_AMOUNT;
    });
  const canPublishDonation =
    (overlayDraft.donationMessage as string).trim().length > 0 &&
    overlayAmountsValid &&
    videoReady &&
    !isUploadingVideo;

  return (
    <>
      <div className="serviceActivationPanel" style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <span style={titleStyle}>
              {accentColor
                ? tProfile("donationTitle").replace(/^[^\p{L}]+/u, "")
                : tProfile("donationTitle")}
            </span>
            <span
              style={
                accentColor && !isEnabled
                  ? { ...(descriptionStyle ?? subtleStyle), display: "flex", alignItems: "flex-start", gap: 6 }
                  : (descriptionStyle ?? subtleStyle)
              }
            >
              {accentColor && !isEnabled ? <ServiceInfoIcon color="#7dd3fc" /> : null}
              <span>{tProfile("donationDesc")}</span>
            </span>
          </div>
          <SwitchComponent
            checked={isEnabled}
            activeColor="#7dd3fc"
            disabled={isBusy}
            onChange={(next) => { void handleToggle(next); }}
            label={tProfile("donationEnableLabel")}
          />
        </div>

        {/* Cuando está inactivo, resumen de lo que ofrece (igual que los demás
            servicios). Iconos en azul celeste. Se descubre por hover (laptop) o
            botón "Ver más" (celular). */}
        {!isEnabled && (
          <ServicePreviewReveal service="profileDonation" accentColor="#7dd3fc" />
        )}

        {/* Activado: los mismos items del preview, ahora fijos bajo la descripción. */}
        {isEnabled && (
          <ServiceFeaturePreview service="profileDonation" accentColor="#7dd3fc" />
        )}

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={tProfile("donationConfigTitle")}
        loading={saving}
        confirmDisabled={!canPublishDonation}
        confirmLabel={tProfile("donationPublishExperience")}
        hideFooter={published}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        {published && publishSuccess ? (
          <ServicePublishedSuccess
            shareUrl={publishSuccess.shareUrl}
            copyLabel={
              publishSuccess.entityKind === "community"
                ? tCommon("copyGroupLink")
                : tCommon("copyProfileLink")
            }
            copiedLabel={tCommon("linkCopied")}
            message={tServices("publishedSuccessMessage", {
              service: tServices("donationNoun"),
              entity:
                publishSuccess.entityKind === "community"
                  ? tServices("entityCommunity")
                  : tServices("entityProfile"),
            })}
          />
        ) : (
        <>
        {/* Message */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>{tProfile("donationMessageLabel")}</div>
          <textarea
            value={overlayDraft.donationMessage as string}
            onChange={(e) => setOverlayDraft((p) => ({ ...p, donationMessage: e.target.value.slice(0, 160) }))}
            placeholder={tProfile("donationMessagePlaceholder")}
            disabled={isBusy}
            rows={3}
            maxLength={160}
            style={{ ...inputStyle, width: "100%", resize: "vertical" }}
          />
          <div style={{ ...subtleStyle, textAlign: "end", marginTop: 2 }}>
            {(overlayDraft.donationMessage as string).length} / 160
          </div>
        </div>

        {/* Montos sugeridos: 4 valores editables (MXN crudo, mínimo 50 c/u) */}
        <div style={{ marginTop: -6 }}>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>
            Define 4 montos sugeridos (en {displayCurrency}). Quienes te apoyen los verán como botones para donar con un toque, y también podrán escribir otra cantidad. El mínimo por monto es ${DONATION_MIN_PER_AMOUNT}.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            {[0, 1, 2, 3].map((i) => {
              const rawI = overlayAmounts[i] ?? "";
              const amtI = Number(rawI);
              const belowMinI = rawI.trim() !== "" && Number.isFinite(amtI) && amtI < DONATION_MIN_PER_AMOUNT;
              const netI = Number.isFinite(amtI) && amtI > 0 ? amtI * WALLET_NET_RATE : null; // neto = 75% de la donación
              const showEarnI = netI != null && netI > 0 && !belowMinI;
              return (
              <div key={i} style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="number"
                    min={DONATION_MIN_PER_AMOUNT}
                    step="1"
                    value={rawI}
                    onChange={(e) =>
                      setOverlayDraft((p) => {
                        const current = normalizeSuggestedAmounts(
                          (p.donationSuggestedAmounts as string[]) ?? []
                        );
                        const next = [...current];
                        next[i] = e.target.value;
                        return { ...p, donationSuggestedAmounts: next };
                      })
                    }
                    placeholder={tProfile("donationAmountPlaceholder")}
                    disabled={isBusy}
                    style={{ ...inputStyle, width: "100%", flex: "1 1 auto", minWidth: 0 }}
                  />
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                    + $3
                  </span>
                </div>
                {/* Aviso del mínimo + cuánto ganas, agrupados para que colapsen sin dejar hueco. */}
                <div>
                  <div style={{ maxHeight: belowMinI ? 22 : 0, opacity: belowMinI ? 1 : 0, transform: belowMinI ? "translateY(0)" : "translateY(4px)", overflow: "hidden", transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease" }}>
                    <div style={{ color: "#f87171", fontSize: 12, marginTop: 2 }}>
                      {`El mínimo es $${DONATION_MIN_PER_AMOUNT}`}
                    </div>
                  </div>
                  <div style={{ maxHeight: showEarnI ? 22 : 0, opacity: showEarnI ? 1 : 0, transform: showEarnI ? "translateY(0)" : "translateY(4px)", overflow: "hidden", transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease" }}>
                    <div style={{ ...subtleStyle, fontSize: 11, marginTop: 2 }}>
                      {`Ganas ${formatMoney(netI ?? 0, { baseCurrency: "MXN" })}`}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
          <div style={{ ...subtleStyle, opacity: 0.7, fontSize: 11, marginTop: 8 }}>
            A todas las experiencias se les suman $3 MXN por el cargo de procesamiento de Stripe.
          </div>
        </div>

        {/* Video upload — sin botón: texto celeste clicable + barra de progreso */}
        <div style={{ containerType: "inline-size" }}>
          <style jsx>{`
            @keyframes donationDotBlink {
              0%,
              80%,
              100% {
                opacity: 0.2;
              }
              40% {
                opacity: 1;
              }
            }
            .donationUploadDots span {
              animation: donationDotBlink 1.4s infinite both;
            }
            .donationUploadDots span:nth-child(2) {
              animation-delay: 0.2s;
            }
            .donationUploadDots span:nth-child(3) {
              animation-delay: 0.4s;
            }

            /* CTA de video: texto celeste, centrado. */
            .donationVideoCta {
              display: block;
              width: 100%;
              margin: 0;
              padding: 0;
              border: none;
              background: none;
              color: #7dd3fc;
              font-weight: 600;
              font-family: inherit;
              line-height: 1.4;
              text-align: center;
              cursor: pointer;
            }
            .donationVideoCta:disabled {
              cursor: not-allowed;
            }
            /* Celular: hasta dos renglones, centrados. */
            @media (hover: none) {
              .donationVideoCta {
                white-space: normal;
                font-size: 13px;
              }
            }
            /* Laptop: un solo renglón; la fuente se ajusta al ancho del panel. */
            @media (hover: hover) {
              .donationVideoCta {
                white-space: nowrap;
                font-size: clamp(8px, 2.3cqw, 13px);
              }
            }
          `}</style>

          {isUploadingVideo ? (
            <>
              <div style={{ color: "#7dd3fc", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
                {tProfile("donationVideoUploadingLabel")}
                <span className="donationUploadDots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uploadProgress ?? 100}%`,
                    background: "#fff",
                    borderRadius: 999,
                    transition: "width 200ms ease",
                  }}
                />
              </div>
            </>
          ) : videoReady ? (
            <>
              <button
                type="button"
                className="donationVideoCta"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                {tProfile("donationVideoReadyCta")}
              </button>
              {/* La barra se queda cargada al 100% hasta que se cambie el video. */}
              <div
                style={{
                  height: 3,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: "100%",
                    background: "#fff",
                    borderRadius: 999,
                  }}
                />
              </div>
            </>
          ) : (
            <button
              type="button"
              className="donationVideoCta"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
            >
              {tProfile("donationVideoUploadCta")}
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleVideoSelect}
            style={{ display: "none" }}
          />

          {uploadErr && (
            <div style={{ ...subtleStyle, color: "rgba(255,120,120,0.9)", marginTop: 6 }}>{uploadErr}</div>
          )}
        </div>

        {saveErr && (
          <div style={{ color: "rgba(255,120,120,0.95)", fontSize: 13, fontWeight: 600 }}>{saveErr}</div>
        )}
        </>
        )}
      </OverlayModalComponent>
    </>
  );
}
