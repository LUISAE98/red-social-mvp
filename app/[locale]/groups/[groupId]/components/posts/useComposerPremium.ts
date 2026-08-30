"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getPremiumCapabilities,
  validatePremiumConfiguration,
  type PremiumCapabilities,
  type PremiumValidationResult,
} from "@/lib/posts/premium";
import type {
  GroupVisibility,
  PostContextType,
  PostPremium,
} from "@/lib/posts/types";

type UseComposerPremiumParams = {
  hasVideos: boolean;
  contextType: PostContextType;
  groupVisibility?: GroupVisibility | null;
  viewerIsOwner?: boolean;
  initialPremium?: PostPremium | null;
  /**
   * Respaldo del precio cuando el post lo tiene solo en `oneTimePrice`.
   *
   * Es el campo que de verdad cobra Stripe (`oneTimePrice ?? premium.price`), así que es el
   * más fiable de los dos para enseñárselo al creador.
   */
  initialOneTimePrice?: number | null;
};

type SetPremiumEnabledOptions = {
  keepDraft?: boolean;
};

const DEFAULT_CURRENCY: PostPremium["currency"] = "MXN";
const DEFAULT_PURCHASE_TYPE: PostPremium["purchaseType"] = "one_time";
const DEFAULT_KIND: PostPremium["kind"] = "video";

function parsePriceInput(value: string): number | null {
  const normalizedValue = value.trim().replace(/,/g, "");

  if (!normalizedValue) return null;

  const parsed = Number(normalizedValue);

  if (!Number.isFinite(parsed)) return null;

  return parsed;
}

function getFallbackAccessMode(
  capabilities: PremiumCapabilities,
): PostPremium["accessMode"] {
  return capabilities.allowedAccessModes[0] ?? "public";
}

function getFallbackFreeFor(
  capabilities: PremiumCapabilities,
): PostPremium["freeFor"] {
  return capabilities.allowedFreeForOptions[0] ?? "none";
}

export function useComposerPremium({
  hasVideos,
  contextType,
  groupVisibility = null,
  viewerIsOwner = false,
  initialPremium,
  initialOneTimePrice,
}: UseComposerPremiumParams) {
  const [premiumEnabled, setPremiumEnabledState] = useState(() => initialPremium?.enabled === true);
  const [accessMode, setAccessModeState] =
    useState<PostPremium["accessMode"]>(() => initialPremium?.accessMode ?? "public");
  const [freeFor, setFreeForState] = useState<PostPremium["freeFor"]>(() => initialPremium?.freeFor ?? "none");
  /**
   * El precio guardado, ya en la moneda de liquidación. Sin conversión, ver abajo.
   *
   * ⚠️ Con respaldo en `initialOneTimePrice`: el precio vive por partida doble y hay posts
   * —2 de los 5 de producción— con `oneTimePrice` puesto y `premium.price` vacío. Sin el
   * respaldo, al editarlos el campo salía en blanco como si no tuvieran precio.
   */
  const [priceInput, setPriceInput] = useState(() => {
    const guardado = initialPremium?.price ?? initialOneTimePrice;
    return guardado != null ? String(guardado) : "";
  });

  /**
   * 🚫 AQUÍ NO SE CONVIERTE NADA. El precio se muestra tal como está guardado.
   *
   * Vivía aquí un efecto que lo pasaba a la moneda de visualización del creador. Tenía
   * sentido cuando el precio se guardaba en pesos y el campo se rotulaba en la moneda de
   * quien miraba. Hoy las dos cosas cambiaron: `lib/posts/premium.ts` normaliza el precio a
   * `SETTLEMENT_CURRENCY` al guardar, y el panel rotula el campo con `SETTLEMENT_CURRENCY`
   * fijo. Convertirlo dejaba el número en euros con la etiqueta «USD» al lado.
   *
   * 🚩 El efecto llevaba dentro un `if (displayCurrency === "MXN") return;` que lo saltaba,
   *    así que el fallo NO se veía con la moneda en dólares ni en pesos —las dos que usa
   *    cualquiera que pruebe desde México— y sí en las otras ~74. Un creador con euros veía
   *    92 donde su post costaba 100.
   *
   * No llegó a cobrar de menos: el campo es de solo lectura al editar y el callable
   * `updatePost` solo acepta `postId`, `text` y `media`, así que el precio no podía viajar.
   * Era una mentira en pantalla, no un cobro malo. Verificado el 2026-08-30 contra los
   * 5 posts premium de producción, todos con el precio en USD.
   */

  const premiumContext = useMemo(
    () => ({
      contextType,
      groupVisibility,
      viewerIsOwner,
    }),
    [contextType, groupVisibility, viewerIsOwner],
  );

  const capabilities = useMemo(
    () =>
      getPremiumCapabilities({
        hasVideos,
        context: premiumContext,
      }),
    [hasVideos, premiumContext],
  );

  // En edit mode con post ya premium, forzamos canEnablePremium = true aunque
  // el contexto (isOwner, groupVisibility) no lo permita normalmente.
  const isEditModePremium = initialPremium?.enabled === true;

  const effectiveCapabilities = useMemo<PremiumCapabilities>(() => {
    if (!isEditModePremium || capabilities.canEnablePremium) return capabilities;
    const allowedAccessModes: PostPremium["accessMode"][] =
      capabilities.allowedAccessModes.length > 0
        ? capabilities.allowedAccessModes
        : initialPremium?.accessMode
          ? [initialPremium.accessMode]
          : ["public"];
    const allowedFreeForOptions: PostPremium["freeFor"][] =
      capabilities.allowedFreeForOptions.length > 0
        ? capabilities.allowedFreeForOptions
        : initialPremium?.freeFor !== undefined
          ? [initialPremium.freeFor]
          : ["none"];
    return { canEnablePremium: true, allowedAccessModes, allowedFreeForOptions, disabledReason: null };
  }, [capabilities, initialPremium, isEditModePremium]);

  // El creador teclea en su moneda y el precio se GUARDA en la de liquidación. Es la base
  // del creador — el backend cobra base + cargo fijo + el impuesto del país del comprador,
  // y el ledger le da el 75% de esta base. Igual que las experiencias.
  //
  // 🚩 SIN VERIFICAR (2026-08-30). El comentario anterior decía «Mexico-only… se guarda TAL
  //    CUAL en MXN», que contradice al código de arriba: la hidratación usa
  //    `SETTLEMENT_CURRENCY` como respaldo, y ésa es USD desde el corte. Peor, la línea
  //    `if (displayCurrency === "MXN") return;` del efecto de hidratación se salta la
  //    conversión, así que un creador con la moneda puesta en pesos podría estar viendo el
  //    número en dólares y leyéndolo como pesos. Se corrigió el comentario, NO el código:
  //    hace falta comprobarlo contra un post premium real antes de tocar nada.
  const typedPrice = useMemo(() => parsePriceInput(priceInput), [priceInput]);
  const price = typedPrice;

  function resetPremium() {
    setPremiumEnabledState(false);
    setAccessModeState(getFallbackAccessMode(effectiveCapabilities));
    setFreeForState(getFallbackFreeFor(effectiveCapabilities));
    setPriceInput("");
  }

  function setPremiumEnabled(
    nextEnabled: boolean,
    options: SetPremiumEnabledOptions = {},
  ) {
    if (!nextEnabled) {
      if (options.keepDraft) {
        setPremiumEnabledState(false);
        return;
      }

      resetPremium();
      return;
    }

    if (!effectiveCapabilities.canEnablePremium) {
      resetPremium();
      return;
    }

    setPremiumEnabledState(true);
    setAccessModeState((current) =>
      effectiveCapabilities.allowedAccessModes.includes(current)
        ? current
        : getFallbackAccessMode(effectiveCapabilities),
    );
    setFreeForState((current) =>
      effectiveCapabilities.allowedFreeForOptions.includes(current)
        ? current
        : getFallbackFreeFor(effectiveCapabilities),
    );
  }

  function togglePremiumEnabled() {
    setPremiumEnabled(!premiumEnabled);
  }

  function setAccessMode(nextAccessMode: PostPremium["accessMode"]) {
    if (!effectiveCapabilities.allowedAccessModes.includes(nextAccessMode)) return;
    setAccessModeState(nextAccessMode);
    // Alcance "solo miembros": no hay nadie fuera de la comunidad a quien cobrarle,
    // así que los miembros pagan por definición (es justo lo que exige la validación
    // `members_only_premium_requires_paid_members_access`). Se normaliza aquí para
    // que el estado nunca quede en una combinación que el publicar rechace.
    if (nextAccessMode === "members_only") {
      setFreeForState("none");
    }
  }

  function setFreeFor(nextFreeFor: PostPremium["freeFor"]) {
    if (!effectiveCapabilities.allowedFreeForOptions.includes(nextFreeFor)) return;
    setFreeForState(nextFreeFor);
  }

  useEffect(() => {
    if (!effectiveCapabilities.canEnablePremium) {
      resetPremium();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCapabilities.canEnablePremium]);

  useEffect(() => {
    if (!effectiveCapabilities.canEnablePremium) return;

    setAccessModeState((current) =>
      effectiveCapabilities.allowedAccessModes.includes(current)
        ? current
        : getFallbackAccessMode(effectiveCapabilities),
    );

    setFreeForState((current) =>
      effectiveCapabilities.allowedFreeForOptions.includes(current)
        ? current
        : getFallbackFreeFor(effectiveCapabilities),
    );
  }, [effectiveCapabilities]);

  useEffect(() => {
    if (contextType !== "profile") return;

    setAccessModeState("public");
    setFreeForState("none");
  }, [contextType]);

  const premium = useMemo<PostPremium | null>(() => {
    if (!premiumEnabled || !effectiveCapabilities.canEnablePremium) return null;

    return {
      enabled: true,
      kind: DEFAULT_KIND,
      accessMode: contextType === "profile" ? "public" : accessMode,
      freeFor: contextType === "profile" ? "none" : freeFor,
      price,
      currency: DEFAULT_CURRENCY,
      purchaseType: DEFAULT_PURCHASE_TYPE,
    };
  }, [
    premiumEnabled,
    effectiveCapabilities.canEnablePremium,
    contextType,
    accessMode,
    freeFor,
    price,
  ]);

  const validation = useMemo<PremiumValidationResult>(
    () =>
      validatePremiumConfiguration({
        premium,
        hasVideos,
        context: premiumContext,
        allowedAccessModesOverride: isEditModePremium
          ? effectiveCapabilities.allowedAccessModes
          : undefined,
        allowedFreeForOptionsOverride: isEditModePremium
          ? effectiveCapabilities.allowedFreeForOptions
          : undefined,
      }),
    [premium, hasVideos, premiumContext, isEditModePremium, effectiveCapabilities.allowedAccessModes, effectiveCapabilities.allowedFreeForOptions],
  );

  const premiumErrorMessage =
    validation.errors[0]?.message ?? effectiveCapabilities.disabledReason ?? null;

  return {
    premium,
    premiumEnabled,
    setPremiumEnabled,
    togglePremiumEnabled,
    resetPremium,

    accessMode,
    setAccessMode,

    freeFor,
    setFreeFor,

    priceInput,
    setPriceInput,
    price,

    capabilities: effectiveCapabilities,
    validation,
    premiumErrorMessage,

    canEnablePremium: effectiveCapabilities.canEnablePremium,
    canSubmitPremium: validation.valid,
    allowedAccessModes: effectiveCapabilities.allowedAccessModes,
    allowedFreeForOptions: effectiveCapabilities.allowedFreeForOptions,
  };
}