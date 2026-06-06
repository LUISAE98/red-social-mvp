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
}: UseComposerPremiumParams) {
  const [premiumEnabled, setPremiumEnabledState] = useState(false);
  const [accessMode, setAccessModeState] =
    useState<PostPremium["accessMode"]>("public");
  const [freeFor, setFreeForState] = useState<PostPremium["freeFor"]>("none");
  const [priceInput, setPriceInput] = useState("");

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

  const price = useMemo(() => parsePriceInput(priceInput), [priceInput]);

  function resetPremium() {
    setPremiumEnabledState(false);
    setAccessModeState(getFallbackAccessMode(capabilities));
    setFreeForState(getFallbackFreeFor(capabilities));
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

    if (!capabilities.canEnablePremium) {
      resetPremium();
      return;
    }

    setPremiumEnabledState(true);
    setAccessModeState((current) =>
      capabilities.allowedAccessModes.includes(current)
        ? current
        : getFallbackAccessMode(capabilities),
    );
    setFreeForState((current) =>
      capabilities.allowedFreeForOptions.includes(current)
        ? current
        : getFallbackFreeFor(capabilities),
    );
  }

    function togglePremiumEnabled() {
    setPremiumEnabled(!premiumEnabled);
  }

  function setAccessMode(nextAccessMode: PostPremium["accessMode"]) {
    if (!capabilities.allowedAccessModes.includes(nextAccessMode)) return;
    setAccessModeState(nextAccessMode);
  }

  function setFreeFor(nextFreeFor: PostPremium["freeFor"]) {
    if (!capabilities.allowedFreeForOptions.includes(nextFreeFor)) return;
    setFreeForState(nextFreeFor);
  }

  useEffect(() => {
    if (!hasVideos || !capabilities.canEnablePremium) {
      resetPremium();
    }
    // resetPremium depende de capabilities; aquí queremos reaccionar solo al cambio real de elegibilidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVideos, capabilities.canEnablePremium]);

  useEffect(() => {
    if (!capabilities.canEnablePremium) return;

    setAccessModeState((current) =>
      capabilities.allowedAccessModes.includes(current)
        ? current
        : getFallbackAccessMode(capabilities),
    );

    setFreeForState((current) =>
      capabilities.allowedFreeForOptions.includes(current)
        ? current
        : getFallbackFreeFor(capabilities),
    );
  }, [capabilities]);

  useEffect(() => {
    if (contextType !== "profile") return;

    setAccessModeState("public");
    setFreeForState("none");
  }, [contextType]);

  const premium = useMemo<PostPremium | null>(() => {
    if (!premiumEnabled || !capabilities.canEnablePremium) return null;

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
    capabilities.canEnablePremium,
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
      }),
    [premium, hasVideos, premiumContext],
  );

  const premiumErrorMessage =
    validation.errors[0]?.message ?? capabilities.disabledReason ?? null;

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

    capabilities,
    validation,
    premiumErrorMessage,

    canEnablePremium: capabilities.canEnablePremium,
    canSubmitPremium: validation.valid,
    allowedAccessModes: capabilities.allowedAccessModes,
    allowedFreeForOptions: capabilities.allowedFreeForOptions,
  };
}