"use client";

// Qué saludos y consejos puede PUBLICAR alguien como historia.
//
// Vivía dentro de StoryCoverPicker, y por eso el rail no podía saber si había
// algo publicable sin abrir el panel. Como el rail solo aparecía cuando ya había
// historias publicadas, quien no había publicado nunca no tenía dónde empezar.
//
// Las reglas de dos lados:
//   - Como CREADOR solo puedes publicar lo que el comprador te autorizó
//     (`allowCreatorStory`). Es su encargo, con su contexto personal dentro.
//   - Como COMPRADOR puedes publicar lo que recibiste, sin pedir permiso… salvo
//     que venga de una comunidad OCULTA. Ahí publicarlo en tu perfil delataría
//     que esa comunidad existe y quién está dentro.
//
// ⚠️ La consulta SIEMPRE fija `creatorId` o `buyerId` contra tu uid. La regla de
// `greetingRequests` exige ser una de las dos partes, y en un `list` de Firestore
// una condición que no esté fijada en la consulta deniega el resultado ENTERO.
// La versión anterior filtraba las de comunidad solo por `groupId`, así que el
// panel de comunidad fallaba siempre y el `.catch` se comía el error: se veía
// como que la función de publicar había desaparecido.

import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryType } from "./types";

export type PublishableGreeting = {
  id: string;
  toName: string;
  instructions: string;
  muxPlaybackId: string | null;
  videoDuration: number | null;
  /** Quién grabó el video. */
  creatorId: string;
  groupId: string | null;
  /** "creator" = lo grabé yo; "buyer" = lo compré yo. */
  role: "creator" | "buyer";
};

export type PublishScope =
  | { kind: "profile" }
  /** Publicar en nombre de una comunidad. Solo lo que grabaste tú ahí dentro. */
  | { kind: "group"; groupId: string };

type Params = {
  uid: string | null | undefined;
  type: StoryType;
  scope: PublishScope;
  /** Sin esto no se consulta nada (por ejemplo, si no eres el dueño). */
  enabled?: boolean;
};

const visibilityCache = new Map<string, string | null>();

async function groupVisibility(groupId: string): Promise<string | null> {
  const cached = visibilityCache.get(groupId);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  try {
    const snap = await getDoc(doc(db, "groups", groupId));
    const raw = snap.get("visibility");
    value = typeof raw === "string" ? raw : null;
  } catch {
    // No poder leer la comunidad es motivo suficiente para no publicar de ella.
    value = null;
  }
  visibilityCache.set(groupId, value);
  return value;
}

function toItem(
  id: string,
  g: Record<string, unknown>,
  role: "creator" | "buyer",
): PublishableGreeting {
  return {
    id,
    toName: typeof g.toName === "string" ? g.toName : "",
    instructions: typeof g.instructions === "string" ? g.instructions : "",
    muxPlaybackId: typeof g.muxPlaybackId === "string" ? g.muxPlaybackId : null,
    videoDuration: typeof g.videoDuration === "number" ? g.videoDuration : null,
    creatorId: typeof g.creatorId === "string" ? g.creatorId : "",
    groupId: typeof g.groupId === "string" && g.groupId ? g.groupId : null,
    role,
  };
}

/**
 * Por qué se quedó fuera cada encargo. Sin esto, un panel vacío obliga a adivinar
 * la causa, y adivinar en voz alta es peor que no decir nada.
 */
export type PublishableStats = {
  /** Encargos tuyos de este tipo, antes de filtrar. */
  fetched: number;
  notDelivered: number;
  noVideo: number;
  noPermission: number;
  hiddenGroup: number;
};

const NO_ITEMS: PublishableGreeting[] = [];
const NO_STATS: PublishableStats = {
  fetched: 0,
  notDelivered: 0,
  noVideo: 0,
  noPermission: 0,
  hiddenGroup: 0,
};

/** El resultado va marcado con la consulta que lo produjo. */
type Result = { key: string; items: PublishableGreeting[]; stats: PublishableStats };

export function usePublishableGreetings({ uid, type, scope, enabled = true }: Params) {
  const [result, setResult] = useState<Result | null>(null);

  const groupId = scope.kind === "group" ? scope.groupId : null;
  const key = `${uid ?? ""}|${type}|${groupId ?? ""}`;

  useEffect(() => {
    if (!enabled || !uid) {
      return;
    }
    let cancelled = false;

    (async () => {
      const out: PublishableGreeting[] = [];
      const stats: PublishableStats = { ...NO_STATS };
      const ref = collection(db, "greetingRequests");

      /** Filtros comunes. Devuelve false y apunta el motivo. */
      const passesBase = (g: Record<string, unknown>): boolean => {
        if (g.type !== type) return false;
        stats.fetched += 1;
        if (g.status !== "delivered") {
          stats.notDelivered += 1;
          return false;
        }
        if (!g.muxPlaybackId) {
          stats.noVideo += 1;
          return false;
        }
        return true;
      };

      try {
        if (groupId) {
          // En una comunidad publica quien grabó, y solo lo suyo de ahí dentro.
          // Se fijan LOS DOS campos: `creatorId` para que la regla pase, y
          // `groupId` para acotar a esta comunidad.
          const snap = await getDocs(
            query(ref, where("creatorId", "==", uid), where("groupId", "==", groupId)),
          );
          for (const d of snap.docs) {
            const g = d.data();
            if (!passesBase(g)) continue;
            if (g.allowCreatorStory === false) {
              stats.noPermission += 1;
              continue;
            }
            out.push(toItem(d.id, g, "creator"));
          }
        } else {
          const [sentSnap, boughtSnap] = await Promise.all([
            getDocs(query(ref, where("creatorId", "==", uid))),
            getDocs(query(ref, where("buyerId", "==", uid))),
          ]);

          for (const d of sentSnap.docs) {
            const g = d.data();
            if (!passesBase(g)) continue;
            // Como creador, solo lo que el comprador autorizó.
            if (g.allowCreatorStory === false) {
              stats.noPermission += 1;
              continue;
            }
            out.push(toItem(d.id, g, "creator"));
          }

          const seen = new Set(out.map((i) => i.id));
          for (const d of boughtSnap.docs) {
            if (seen.has(d.id)) continue;
            const g = d.data();
            if (!passesBase(g)) continue;
            const gid = typeof g.groupId === "string" && g.groupId ? g.groupId : null;
            if (gid) {
              // De una comunidad OCULTA no se puede sacar nada al perfil: sería
              // delatar que existe. De una privada sí, y al publicarla en tu
              // perfil pasa a ser pública, que es lo acordado.
              const visibility = await groupVisibility(gid);
              if (visibility !== "public" && visibility !== "private") {
                stats.hiddenGroup += 1;
                continue;
              }
            }
            out.push(toItem(d.id, g, "buyer"));
          }
        }
      } catch (err) {
        console.error("[usePublishableGreetings]", err);
      }

      if (!cancelled) setResult({ key, items: out, stats });
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, type, groupId, enabled, key]);

  // "Cargando" se DEDUCE de que el resultado sea de otra consulta, en vez de
  // encenderse a mano dentro del efecto. Así no hay un `setState` síncrono que
  // provoque un render en cascada, y al cambiar de tipo o de comunidad nunca se
  // enseña por un instante el resultado de la anterior.
  const items = result?.key === key ? result.items : NO_ITEMS;
  const stats = result?.key === key ? result.stats : NO_STATS;
  const loading = !!enabled && !!uid && result?.key !== key;

  return { items, loading, stats };
}
