"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  getPremiumCapabilities,
  validatePremiumConfiguration,
  type PremiumCapabilities,
  type PremiumValidationResult,
} from "@/lib/posts/premium";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
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
}: UseComposerPremiumParams) {
  const { resolveStoredPrice, toDisplayForInput, currency: displayCurrency } =
    usePriceFormat();

  const [premiumEnabled, setPremiumEnabledState] = useState(() => initialPremium?.enabled === true);
  const [accessMode, setAccessModeState] =
    useState<PostPremium["accessMode"]>(() => initialPremium?.accessMode ?? "public");
  const [freeFor, setFreeForState] = useState<PostPremium["freeFor"]>(() => initialPremium?.freeFor ?? "none");
  const [priceInput, setPriceInput] = useState(() =>
    initialPremium?.price != null ? String(initialPremium.price) : "",
  );

  // Al editar un post premium existente, el precio está guardado en MXN (ancla).
  // Lo mostramos en la moneda del creador para que pueda editarlo en su moneda.
  // Solo una vez, cuando cargan las tasas / cambia la moneda de visualización.
  const didHydratePremiumPrice = useRef(false);
  useEffect(() => {
    if (didHydratePremiumPrice.current) return;
    if (initialPremium?.price == null) return;
    const n = Number(initialPremium.price);
    if (!Number.isFinite(n) || n <= 0) return;
    didHydratePremiumPrice.current = true;
    if (displayCurrency === "MXN") return;
    const shown = toDisplayForInput(n, initialPremium.currency ?? "MXN");
    setPriceInput(String(Math.round(shown * 100) / 100));
  }, [initialPremium?.price, initialPremium?.currency, displayCurrency, toDisplayForInput]);

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

  // El creador teclea en su moneda; el precio se GUARDA en MXN (ancla).
  // Convertimos aquí, en el borde donde el objeto `premium` (que se persiste) se
  // construye. `price` queda ya en MXN para validación y persistencia.
  const typedPrice = useMemo(() => parsePriceInput(priceInput), [priceInput]);
  const price = useMemo(
    () =>
      typedPrice != null && typedPrice > 0
        ? resolveStoredPrice(typedPrice).price
        : typedPrice,
    [typedPrice, resolveStoredPrice],
  );

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