"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useTranslations } from "next-intl";
import { db } from "@/lib/firebase";
import { softDeleteGroup } from "@/lib/groups/groupDeletion";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type OwnerAdminDangerZoneProps = {
  groupId: string;
  groupName?: string | null;
};

export default function OwnerAdminDangerZone({
  groupId,
  groupName,
}: OwnerAdminDangerZoneProps) {
  const router = useRouter();
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [showFinalOverlay, setShowFinalOverlay] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (errorMessage) showToast(errorMessage, "error"); }, [errorMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizedConfirmText = confirmText.trim().toUpperCase();

  const canDelete = useMemo(() => {
    return normalizedConfirmText === "ELIMINAR";
  }, [normalizedConfirmText]);

  async function handlePauseGroup() {
    if (isPausing || isDeleting) return;

    try {
      setIsPausing(true);
      setErrorMessage(null);

      await updateDoc(doc(db, "groups", groupId), {
        isActive: false,
        updatedAt: serverTimestamp(),
      });

      setShowFinalOverlay(false);
      router.refresh();
    } catch (error) {
      console.error("Error pausing group", error);

      const message =
        error instanceof Error
          ? error.message
          : tGroups("pauseCommunityError");

      setErrorMessage(message);
    } finally {
      setIsPausing(false);
    }
  }

  async function handleDeleteGroup() {
    if (!canDelete || isDeleting || isPausing) return;

    try {
      setIsDeleting(true);
      setErrorMessage(null);

      await softDeleteGroup({
        groupId,
        reason: reason.trim() || "owner_deleted",
      });

      router.replace("/groups");
      router.refresh();
    } catch (error) {
      console.error("Error deleting group", error);

      const message =
        error instanceof Error
          ? error.message
          : tGroups("deleteCommunityError");

      setErrorMessage(message);
      setIsDeleting(false);
      setShowFinalOverlay(false);
    }
  }

  return (
    <>
      <section
        style={{
          display: "grid",
          gap: 12,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.035)",
          padding: 12,
        }}
      >
        {!isOpen ? (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            style={{
              minHeight: 38,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {tGroups("deleteCommunityButton")}
          </button>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <h4
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {tGroups("deleteCommunityButton")}
              </h4>

              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "rgba(255,255,255,0.72)",
                  textAlign: "justify",
                }}
              >
                Esta acción ocultará la comunidad para todos los usuarios.
                También desactivará sus posts, invitaciones, solicitudes y
                accesos materializados. Los datos se conservarán internamente
                para auditoría, soporte y trazabilidad.
              </p>

              {groupName ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    color: "rgba(255,255,255,0.62)",
                  }}
                >
                  Comunidad:{" "}
                  <span style={{ color: "#fff", fontWeight: 700 }}>
                    {groupName}
                  </span>
                </p>
              ) : null}
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 650,
                  color: "rgba(255,255,255,0.86)",
                }}
              >
                Motivo interno opcional
              </span>

              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isDeleting || isPausing}
                rows={1}
                maxLength={240}
                placeholder={tGroups("deletionReasonPlaceholder")}
                style={{
                  width: "100%",
                  minHeight: 42,
                  maxHeight: 110,
                  resize: "vertical",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  padding: "10px 11px",
                  fontSize: 12.5,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 650,
                  color: "rgba(255,255,255,0.86)",
                }}
              >
                Escribe ELIMINAR para confirmar
              </span>

              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                disabled={isDeleting || isPausing}
                placeholder="ELIMINAR"
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  padding: "0 11px",
                  fontSize: 12.5,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </label>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "space-between",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setErrorMessage(null);
                  setConfirmText("");
                  setReason("");
                }}
                disabled={isDeleting || isPausing}
                style={{
                  minHeight: 38,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 650,
                  cursor: isDeleting || isPausing ? "not-allowed" : "pointer",
                  opacity: isDeleting || isPausing ? 0.65 : 1,
                }}
              >
                {tCommon("cancel")}
              </button>

              <button
                type="button"
                onClick={() => setShowFinalOverlay(true)}
                disabled={!canDelete || isDeleting || isPausing}
                style={{
                  minHeight: 38,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: canDelete
                    ? "rgba(255,255,255,0.92)"
                    : "rgba(255,255,255,0.12)",
                  color: canDelete ? "#000" : "rgba(255,255,255,0.52)",
                  fontSize: 12.5,
                  fontWeight: 750,
                  cursor:
                    !canDelete || isDeleting || isPausing
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {tGroups("deleteCommunityButton")}
              </button>
            </div>
          </div>
        )}
      </section>

      {showFinalOverlay ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.68)",
            display: "grid",
            placeItems: "center",
            padding: 18,
          }}
        >
          <div
            style={{
              width: "min(460px, 100%)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.12)",
              background:
                "linear-gradient(135deg, rgb(12,10,18) 0%, rgb(5,5,8) 100%)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.72)",
              padding: 18,
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <h3
                style={{
                  margin: 0,
                  color: "#fff",
                  fontSize: 17,
                  fontWeight: 800,
                  lineHeight: 1.2,
                }}
              >
                ¿Seguro que quieres eliminar tu comunidad o solo quieres
                pausarla?
              </h3>

              <p
                style={{
                  margin: 0,
                  color: "rgba(255,255,255,0.68)",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                }}
              >
                Si la pausas, la comunidad queda inactiva sin eliminar su
                historial. Si la eliminas, se ocultará y se desactivarán sus
                accesos relacionados.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={handlePauseGroup}
                disabled={isPausing || isDeleting}
                style={{
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: isPausing || isDeleting ? "not-allowed" : "pointer",
                  opacity: isPausing || isDeleting ? 0.7 : 1,
                }}
              >
                {isPausing ? "Pausando..." : "Solo pausarla"}
              </button>

              <button
                type="button"
                onClick={handleDeleteGroup}
                disabled={isPausing || isDeleting}
                style={{
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "#fff",
                  color: "#000",
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: isPausing || isDeleting ? "not-allowed" : "pointer",
                  opacity: isPausing || isDeleting ? 0.76 : 1,
                }}
              >
                {isDeleting ? "Eliminando..." : "Sí, eliminar comunidad"}
              </button>

              <button
                type="button"
                onClick={() => setShowFinalOverlay(false)}
                disabled={isPausing || isDeleting}
                style={{
                  minHeight: 36,
                  borderRadius: 10,
                  border: "0",
                  background: "transparent",
                  color: "rgba(255,255,255,0.62)",
                  fontSize: 12,
                  fontWeight: 650,
                  cursor: isPausing || isDeleting ? "not-allowed" : "pointer",
                }}
              >
                Volver
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <VibraToast toast={toast} />
    </>
  );
}