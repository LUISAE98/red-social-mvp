"use client";

/**
 * Compositor del home.
 *
 * Publica en TU PERFIL, no en una comunidad. Es el mismo `GroupPostComposer` que
 * usa el perfil (`contextType="profile"`) y la misma lógica de subida
 * (`lib/posts/createProfilePost`); aquí solo se añade lo que el home necesita:
 * decir a dónde va la publicación y avisar cuando termina para refrescar el feed.
 *
 * 🚨 EL DESTINO SE DICE EN VOZ ALTA 🚨
 * En el perfil no hay ambigüedad posible: estás en tu perfil, publicas en tu
 * perfil. El home es una superficie compartida y Vibra tiene comunidades como
 * pilar, así que alguien con comunidades propias puede asumir que aquí elige
 * dónde publicar. La etiqueta de destino evita ese error, que no se deshace
 * socialmente aunque borres el post. Hoy solo hay una opción; el hueco queda
 * listo para cuando se permita elegir comunidad.
 *
 * Sin botón de live a propósito: `onLiveClick` es opcional y, al no pasarlo, el
 * compositor no lo pinta. Transmitir tiene su propio flujo de preparación y no
 * es algo que se lance desde el home de pasada.
 */

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

import GroupPostComposer from "@/app/groups/[groupId]/components/posts/GroupPostComposer";
import { createProfilePost } from "@/lib/posts/createProfilePost";
import { clearAllPostFeedCaches } from "@/lib/posts/post-feed-cache";
import { waitForOwnHomeFeedPost } from "@/lib/posts/waitForOwnHomeFeedPost";
import type { PostPremium } from "@/lib/posts/types";

type HomeComposerMediaItem = {
  type: "image" | "video";
  file: File;
  coverFile?: File | null;
};

type HomeComposerSubmitPayload = {
  text: string;
  imageFiles?: File[];
  videoFiles?: File[];
  mediaItems?: HomeComposerMediaItem[];
  premium?: PostPremium | null;
};

export default function HomePostComposer({
  currentUserId,
  onPublished,
}: {
  currentUserId: string;
  /** Se llama tras publicar, para que el home refresque su feed. */
  onPublished?: () => void;
}) {
  const tNav = useTranslations("nav");
  const tProfile = useTranslations("profile");

  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(payload: HomeComposerSubmitPayload) {
    // Se empieza a escuchar ANTES de publicar: si se arrancara después, el
    // trigger podría haber escrito ya el documento y la línea base nacería
    // incluyendo la publicación nueva, con lo que nunca detectaríamos su
    // llegada y el feed se quedaría sin refrescar.
    let stopWaiting: (() => void) | null = waitForOwnHomeFeedPost({
      uid: currentUserId,
      onArrived: () => {
        clearAllPostFeedCaches();
        onPublished?.();
      },
    });

    try {
      setError(null);
      setUploadProgress(null);
      setUploadStatus(null);

      const result = await createProfilePost({
        profileUid: currentUserId,
        payload,
        labels: {
          validatingVideos: tProfile("validatingVideos"),
          uploadingCovers: tProfile("uploadingCovers"),
          preparingUpload: tProfile("preparingUpload"),
          preparePostError: tProfile("preparePostError"),
          creatingPost: tProfile("creatingPost"),
          uploadingVideo: (index, total) =>
            tProfile("uploadingVideo", { index, total }),
          videosUploaded: tProfile("videosUploaded"),
        },
        onStatus: setUploadStatus,
        onProgress: setUploadProgress,
      });

      if (!result.ok) {
        // No se publicó nada: no hay nada que esperar.
        stopWaiting?.();
        stopWaiting = null;

        setError(
          result.reason === "tooManyVideos"
            ? tProfile("maxVideosError")
            : tProfile("videoDurationError")
        );
        return;
      }

      // El refresco NO se dispara aquí. La publicación ya existe, pero su
      // documento del feed lo escribe un trigger que aún puede no haber corrido:
      // refrescar ahora traería la lista de antes. Lo lanza `onArrived` cuando
      // el documento aparece de verdad.

      window.setTimeout(() => {
        setUploadProgress(null);
        setUploadStatus(null);
      }, 2500);
    } catch (e: unknown) {
      stopWaiting?.();
      stopWaiting = null;

      setError((e instanceof Error ? e.message : null) ?? tProfile("postError"));
      setUploadProgress(null);
      setUploadStatus(null);
      throw e;
    }
  }

  const destinationStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 4px 6px",
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    lineHeight: 1.3,
  };

  return (
    <section style={{ width: "100%", minWidth: 0, padding: "8px 12px 4px" }}>
      <div style={destinationStyle}>
        <span>{tNav("publishTo")}</span>
        <span style={{ color: "rgba(255,255,255,0.82)", fontWeight: 600 }}>
          {tNav("profile")}
        </span>
      </div>

      <GroupPostComposer
        contextType="profile"
        isOwner
        onSubmit={handleSubmit}
      />

      {uploadStatus ? (
        <div
          style={{
            marginTop: 10,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(15, 23, 42, 0.72)",
            padding: 12,
            color: "rgba(255,255,255,0.84)",
            fontSize: 13,
          }}
        >
          <div style={{ marginBottom: 8 }}>{uploadStatus}</div>

          {uploadProgress !== null ? (
            <>
              <div
                style={{
                  height: 8,
                  width: "100%",
                  overflow: "hidden",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.1)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uploadProgress}%`,
                    borderRadius: 999,
                    background: "rgba(96,165,250,0.95)",
                    transition: "width 160ms ease",
                  }}
                />
              </div>

              <div style={{ marginTop: 6, fontSize: 12 }}>{uploadProgress}%</div>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(248,113,113,0.22)",
            background: "rgba(248,113,113,0.08)",
            color: "#fecaca",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      ) : null}
    </section>
  );
}
