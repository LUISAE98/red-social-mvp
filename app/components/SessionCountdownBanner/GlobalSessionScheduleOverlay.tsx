"use client";

// Host global del panel de reagenda de sesiones (Tiempo contigo / Sesión exclusiva).
//
// El card flotante del creador (CreatorSessionCountdownBanner) vive en un portal
// global y NO puede alcanzar el SessionRequestOverlay del OwnerSidebar (que en
// móvil está `display:none` y se monta de forma condicional). Para reutilizar EL
// MISMO panel, el card despacha un CustomEvent y este host —montado junto a
// GlobalSessionCard en el layout— lo escucha, trae el doc y abre el overlay.

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import SessionRequestOverlay from "@/app/components/OwnerSidebar/SessionRequestOverlay";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import type {
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
} from "@/app/components/OwnerSidebar/OwnerSidebar";
import {
  acceptMeetGreetRequest,
  rejectMeetGreetRequest,
  proposeMeetGreetSchedule,
  setMeetGreetPreparing,
  declineMeetGreetReschedule,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  rejectExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  setExclusiveSessionPreparing,
  declineExclusiveSessionReschedule,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";

export const OPEN_SESSION_SCHEDULE_EVENT = "vibra:open-session-schedule";

type ServiceKind = "meet_greet" | "exclusive_session";

type OverlayState = {
  id: string;
  serviceKind: ServiceKind;
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
};

export default function GlobalSessionScheduleOverlay() {
  const [state, setState] = useState<OverlayState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast: scheduleToast, showToast: showScheduleToast } = useVibraToast();

  useEffect(() => { if (error) showScheduleToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  // El operador del card ES el creador; sus sesiones agendadas alimentan la
  // detección de conflictos en vivo del panel. Con creatorId null no monta
  // listeners (idle), así que solo consulta cuando hay un overlay abierto.
  const { calendar } = useOwnerWalletData(state?.req.creatorId ?? null);

  useEffect(() => {
    async function handleOpen(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { sessionId?: string; serviceKind?: ServiceKind }
        | undefined;
      if (!detail?.sessionId || !detail.serviceKind) return;

      const collectionName =
        detail.serviceKind === "meet_greet"
          ? "meetGreetRequests"
          : "exclusiveSessionRequests";
      try {
        const snap = await getDoc(doc(db, collectionName, detail.sessionId));
        if (!snap.exists()) return;
        setState({
          id: snap.id,
          serviceKind: detail.serviceKind,
          req: {
            ...(snap.data() as MeetGreetRequestDoc | ExclusiveSessionRequestDoc),
            id: snap.id,
          },
        });
        setError(null);
        setBusy(false);
        setOpen(true);
      } catch {
        /* silencioso: si falla la lectura, no abrimos nada */
      }
    }

    window.addEventListener(OPEN_SESSION_SCHEDULE_EVENT, handleOpen as EventListener);
    return () =>
      window.removeEventListener(OPEN_SESSION_SCHEDULE_EVENT, handleOpen as EventListener);
  }, []);

  if (!state) return null;

  const { id, serviceKind, req } = state;
  const isMeetGreet = serviceKind === "meet_greet";

  function close() {
    setOpen(false);
    // Desmontar tras la animación de salida del overlay.
    setTimeout(() => setState(null), 320);
  }

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ocurrió un error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <VibraToast toast={scheduleToast} />
    <SessionRequestOverlay
      open={open}
      onClose={close}
      request={req}
      requestId={id}
      serviceKind={serviceKind}
      earning={null}
      busy={busy}
      ownerCalendarItems={calendar}
      getInitials={(name) => (name ?? "?").charAt(0).toUpperCase()}
      onAccept={() =>
        run(() =>
          isMeetGreet
            ? acceptMeetGreetRequest({ requestId: id })
            : acceptExclusiveSessionRequest({ requestId: id })
        )
      }
      onReject={(reason) =>
        run(() =>
          isMeetGreet
            ? rejectMeetGreetRequest({ requestId: id, rejectionReason: reason })
            : rejectExclusiveSessionRequest({ requestId: id, rejectionReason: reason })
        )
      }
      onSchedule={(scheduledAt, note) => {
        if (!scheduledAt) return;
        return run(() =>
          isMeetGreet
            ? proposeMeetGreetSchedule({ requestId: id, scheduledAt, note })
            : proposeExclusiveSessionSchedule({ requestId: id, scheduledAt, note })
        );
      }}
      onAcceptAndSchedule={(scheduledAt, note) => {
        if (!scheduledAt) return;
        void run(async () => {
          if (isMeetGreet) {
            await acceptMeetGreetRequest({ requestId: id });
            await proposeMeetGreetSchedule({ requestId: id, scheduledAt, note });
          } else {
            await acceptExclusiveSessionRequest({ requestId: id });
            await proposeExclusiveSessionSchedule({ requestId: id, scheduledAt, note });
          }
        });
      }}
      onPrepare={() =>
        void run(() =>
          isMeetGreet
            ? setMeetGreetPreparing({ requestId: id, role: "creator" })
            : setExclusiveSessionPreparing({ requestId: id, role: "creator" })
        )
      }
      onKeepSchedule={() =>
        run(() =>
          isMeetGreet
            ? declineMeetGreetReschedule(id)
            : declineExclusiveSessionReschedule({ requestId: id })
        )
      }
    />
    </>
  );
}
