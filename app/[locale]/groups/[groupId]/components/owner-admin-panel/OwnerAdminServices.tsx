"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildNormalizedGroupCommerceState } from "@/lib/groups/groupServiceCatalog";
import {
  applyGroupSubscriptionTransition,
  removeLegacyFreeMembersAfterSubscriptionTransition,
} from "@/lib/groups/subscriptionTransitions";
import type {
  Currency,
  GroupOffering,
  CreatorServiceType,
  GroupDonationSettings,
  DonationMode,
  CreatorServiceMeta,
  CustomClassWeeklyAvailability,
} from "@/types/group";

import Subscription from "./services/Subscription";
import Greetings from "./services/Greetings";
import Advice from "./services/Advice";
import MeetGreet from "./services/MeetGreet";
import CustomClass from "./services/CustomClass";
import Donation from "./services/Donation";
import {
  SERVICE_EMOJIS, SpinningGear, Switch, DonationModeButton,
  buildManualLegacyRemovalSuccessMessage, buildOffering, buildServiceBlockDraft,
  buildSubscriptionDraft, buildTransitionSuccessMessage, calcNetAmount,
  createEmptyDraft, createEmptyWeeklyAvailability, normalizeDurationMeta,
  normalizeWeeklyAvailabilityFromMeta, pickDonation, pickOffering,
  pickSubscription, pickTransitions, sameDraft,
  type Props, type ServiceDraft,
} from "./OwnerAdminServices.parts";
import { ConfirmModal, OverlayModal } from "./OwnerAdminServices.modals";

export default function OwnerAdminServices({
  groupId,
  ownerId,
  currentUserId,
  currentVisibility = null,
  currentMonetization = null,
  currentOfferings = null,
  currentDonation = null,
}: Props) {
  const priceFmt = usePriceFormat();
  const formatMoney = (value: number, currency?: string) =>
    priceFmt.format(value, { baseCurrency: currency ?? "MXN", code: true });

  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const isPublic = currentVisibility === "public";

  const [draft, setDraft] = useState<ServiceDraft>(createEmptyDraft());
  const [savedDraft, setSavedDraft] = useState<ServiceDraft>(createEmptyDraft());

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast: adminServicesToast, showToast: showAdminServicesToast } = useVibraToast();
  useEffect(() => { if (err) showAdminServicesToast(err, "error"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps

  const [removingLegacyMembers, setRemovingLegacyMembers] = useState(false);
  const [activeLegacyFreeMembersCount, setActiveLegacyFreeMembersCount] =
    useState(0);

  const hasActiveLegacyFreeMembers = activeLegacyFreeMembersCount > 0;

  const canRemoveLegacyFreeMembersLater =
    !isPublic &&
    (currentMonetization?.subscriptionsEnabled === true ||
      currentMonetization?.isPaid === true) &&
    hasActiveLegacyFreeMembers;

  const lastHydratedGroupIdRef = useRef<string | null>(null);
  const skipHydrationWhileSavingRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    if (skipHydrationWhileSavingRef.current) return;

    const sub = pickSubscription(currentMonetization);
    const transitions = pickTransitions(currentMonetization);
    const saludo = pickOffering(currentOfferings, "saludo");
    const consejo = pickOffering(currentOfferings, "consejo");
    const meetGreet = pickOffering(currentOfferings, "meet_greet_digital");
    const customClass = pickOffering(currentOfferings, "clase_personalizada");
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscription: buildSubscriptionDraft({
        enabled: isPublic ? false : sub.enabled,
        price: isPublic ? null : sub.price,
        currency: sub.currency ?? "MXN",
      }),
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? "MXN",
        visible: saludo.enabled,
        visibility: "members",
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? "MXN",
        visible: consejo.enabled,
        visibility: "members",
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? "MXN",
          visible: meetGreet.enabled,
          visibility: "members",
        }),
        durationMinutes: normalizeDurationMeta(meetGreet.meta, "meetGreet"),
      },
      customClass: {
        ...buildServiceBlockDraft({
          enabled: customClass.enabled,
          price: customClass.price,
          currency: customClass.currency ?? "MXN",
          visible: customClass.enabled,
          visibility: "members",
        }),
        durationMinutes: normalizeDurationMeta(
          customClass.meta,
          "customClass"
        ),
        availability: normalizeWeeklyAvailabilityFromMeta(customClass.meta),
      },
      donationMode: donation.mode,
      donationCurrency: donation.currency ?? "MXN",
      donationMinimumAmount: donation.minimumAmount,
      donationGoalLabel: donation.goalLabel ?? "",
      donationMessage: donation.message ?? "",
      donationVideoUrl: donation.videoUrl ?? "",
      donationPlaybackId: donation.playbackId ?? "",
      freeToSubscriptionPolicy: transitions.freeToSubscriptionPolicy,
      subscriptionToFreePolicy: transitions.subscriptionToFreePolicy,
      subscriptionPriceIncreasePolicy:
        transitions.subscriptionPriceIncreasePolicy,
    };

    const isFirstHydrationForGroup = lastHydratedGroupIdRef.current !== groupId;

    if (isFirstHydrationForGroup) {
      lastHydratedGroupIdRef.current = groupId;
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setErr(null);
      return;
    }

    setSavedDraft((prevSaved) => {
      if (sameDraft(prevSaved, nextDraft)) return prevSaved;
      return nextDraft;
    });

    setDraft((prevDraft) => {
      const hasUnsavedChanges = !sameDraft(prevDraft, savedDraft);
      if (hasUnsavedChanges) return prevDraft;
      return nextDraft;
    });
  }, [
    groupId,
    isOwner,
    isPublic,
    currentMonetization,
    currentOfferings,
    currentDonation,
    savedDraft,
  ]);

  useEffect(() => {
    if (!isOwner) {
      setActiveLegacyFreeMembersCount(0);
      return;
    }

    const subscriptionIsPersistedActive =
      currentMonetization?.subscriptionsEnabled === true ||
      currentMonetization?.isPaid === true;

    if (isPublic || !subscriptionIsPersistedActive) {
      setActiveLegacyFreeMembersCount(0);
      return;
    }

    const membersRef = collection(db, "groups", groupId, "members");

    const unsubscribe = onSnapshot(
      membersRef,
      (snapshot) => {
        let count = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as {
            status?: string;
            roleInGroup?: string;
            role?: string;
            accessType?: string | null;
            legacyComplimentary?: boolean;
            subscriptionActive?: boolean;
            requiresSubscription?: boolean;
          };

          const roleRaw =
            typeof data.roleInGroup === "string"
              ? data.roleInGroup
              : typeof data.role === "string"
                ? data.role
                : "";

          const normalizedRole = roleRaw.trim().toLowerCase();

          if (
            normalizedRole === "owner" ||
            normalizedRole === "mod" ||
            normalizedRole === "moderator"
          ) {
            return;
          }

          const status =
            typeof data.status === "string"
              ? data.status.trim().toLowerCase()
              : "active";

          if (status !== "active") return;

          const accessType =
            typeof data.accessType === "string"
              ? data.accessType.trim().toLowerCase()
              : "";

          const isLegacyFree =
            accessType === "legacy_free" ||
            data.legacyComplimentary === true ||
            (accessType !== "subscription" &&
              data.subscriptionActive !== true &&
              data.requiresSubscription !== true);

          if (isLegacyFree) {
            count += 1;
          }
        });

        setActiveLegacyFreeMembersCount(count);
      },
      () => {
        setActiveLegacyFreeMembersCount(0);
      }
    );

    return () => unsubscribe();
  }, [
    groupId,
    isOwner,
    isPublic,
    currentMonetization?.subscriptionsEnabled,
    currentMonetization?.isPaid,
  ]);

  if (!isOwner) return null;

  const fontStack =
    'inherit';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
  };

  const panelStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 9,
  };

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 12,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: 42,
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    fontFamily: fontStack,
    lineHeight: 1.1,
    width: "100%",
  };

  async function handleConfirmRemoveLegacyFreeMembersLater() {
    if (!canRemoveLegacyFreeMembersLater) return;

    setRemovingLegacyMembers(true);
    setErr(null);

    try {
      const response =
        await removeLegacyFreeMembersAfterSubscriptionTransition({
          groupId,
        });

      showAdminServicesToast(
        buildManualLegacyRemovalSuccessMessage({
          removedMembers: response.removedMembers,
          reminderMembers: response.reminderMembers,
          skippedMembers: response.skippedMembers,
        })
      );
    } catch (e: unknown) {
      showAdminServicesToast(
        (e instanceof Error ? e.message : null) ??
          "❌ No se pudo retirar a los miembros gratuitos.",
        "error"
      );
    } finally {
      setRemovingLegacyMembers(false);
    }
  }

  async function saveServicesFromDraft(sourceDraft?: ServiceDraft) {
    setSaving(true);
    setErr(null);

    const workingDraft = sourceDraft ?? draft;

    try {
      const subscriptionPriceNum =
        workingDraft.subscription.price.trim() === ""
          ? null
          : Number(workingDraft.subscription.price);

      const saludoPriceNum =
        workingDraft.saludo.price.trim() === ""
          ? null
          : Number(workingDraft.saludo.price);

      const consejoPriceNum =
        workingDraft.consejo.price.trim() === ""
          ? null
          : Number(workingDraft.consejo.price);

      const meetGreetPriceNum =
        workingDraft.meetGreet.price.trim() === ""
          ? null
          : Number(workingDraft.meetGreet.price);

      const customClassPriceNum =
        workingDraft.customClass.price.trim() === ""
          ? null
          : Number(workingDraft.customClass.price);

      const meetGreetDurationNum =
        workingDraft.meetGreet.durationMinutes.trim() === ""
          ? null
          : Number(workingDraft.meetGreet.durationMinutes);

      const customClassDurationNum =
        workingDraft.customClass.durationMinutes.trim() === ""
          ? null
          : Number(workingDraft.customClass.durationMinutes);

      const donationMinimumNum =
        workingDraft.donationMinimumAmount.trim() === ""
          ? null
          : Number(workingDraft.donationMinimumAmount);

      if (
        workingDraft.subscription.enabled &&
        (subscriptionPriceNum == null ||
          Number.isNaN(subscriptionPriceNum) ||
          subscriptionPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para la suscripción mensual.");
        return;
      }

      if (
        workingDraft.saludo.enabled &&
        (saludoPriceNum == null ||
          Number.isNaN(saludoPriceNum) ||
          saludoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para saludos.");
        return;
      }

      if (
        workingDraft.consejo.enabled &&
        (consejoPriceNum == null ||
          Number.isNaN(consejoPriceNum) ||
          consejoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para consejos.");
        return;
      }

      if (
        workingDraft.meetGreet.enabled &&
        (meetGreetPriceNum == null ||
          Number.isNaN(meetGreetPriceNum) ||
          meetGreetPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para Tiempo contigo.");
        return;
      }

      if (
        workingDraft.customClass.enabled &&
        (customClassPriceNum == null ||
          Number.isNaN(customClassPriceNum) ||
          customClassPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para sesión exclusiva.");
        return;
      }

      if (
        workingDraft.meetGreet.enabled &&
        (meetGreetDurationNum == null ||
          Number.isNaN(meetGreetDurationNum) ||
          meetGreetDurationNum <= 0 ||
          !Number.isInteger(meetGreetDurationNum))
      ) {
        setErr(
          "❌ Debes definir una duración válida en minutos para Tiempo contigo."
        );
        return;
      }

      if (
        workingDraft.customClass.enabled &&
        (customClassDurationNum == null ||
          Number.isNaN(customClassDurationNum) ||
          customClassDurationNum <= 0 ||
          !Number.isInteger(customClassDurationNum))
      ) {
        setErr(
          "❌ Debes definir una duración válida en minutos para la sesión exclusiva."
        );
        return;
      }

      if (isPublic && workingDraft.subscription.enabled) {
        setErr(
          "❌ Las comunidades públicas no pueden activar suscripción mensual."
        );
        return;
      }

      const savedWasSubscriptionEnabled = savedDraft.subscription.enabled;
      const localWillEnableSubscription =
        !savedWasSubscriptionEnabled &&
        workingDraft.subscription.enabled &&
        !isPublic;
      const localWillDisableSubscription =
        savedWasSubscriptionEnabled && !workingDraft.subscription.enabled;

      const savedPrevSubscriptionPrice =
        savedDraft.subscription.price.trim() === ""
          ? null
          : Number(savedDraft.subscription.price);

      const localNextSubscriptionPrice =
        workingDraft.subscription.price.trim() === ""
          ? null
          : Number(workingDraft.subscription.price);

      const localWillIncreaseSubscriptionPrice =
        !isPublic &&
        savedWasSubscriptionEnabled &&
        workingDraft.subscription.enabled &&
        savedDraft.subscription.currency === workingDraft.subscription.currency &&
        savedPrevSubscriptionPrice != null &&
        localNextSubscriptionPrice != null &&
        !Number.isNaN(savedPrevSubscriptionPrice) &&
        !Number.isNaN(localNextSubscriptionPrice) &&
        localNextSubscriptionPrice > savedPrevSubscriptionPrice;

      if (localWillEnableSubscription && !workingDraft.freeToSubscriptionPolicy) {
        setErr(
          "❌ Debes definir qué pasa con los miembros actuales al cambiar de gratis a suscripción."
        );
        return;
      }

      if (localWillDisableSubscription && !workingDraft.subscriptionToFreePolicy) {
        setErr(
          "❌ Debes definir qué pasa con los integrantes al cambiar de suscripción a gratis."
        );
        return;
      }

      if (
        localWillIncreaseSubscriptionPrice &&
        !workingDraft.subscriptionPriceIncreasePolicy
      ) {
        setErr(
          "❌ Debes definir qué pasa con los suscriptores actuales al subir el precio."
        );
        return;
      }

      if (
        workingDraft.donationMode !== "none" &&
        (donationMinimumNum == null ||
          Number.isNaN(donationMinimumNum) ||
          donationMinimumNum <= 0)
      ) {
        setErr("❌ Debes definir un monto mínimo válido para la donación.");
        return;
      }

      if (
        workingDraft.donationMode === "wedding" &&
        !workingDraft.donationGoalLabel.trim()
      ) {
        setErr("❌ Debes escribir el texto visible para la donación de boda.");
        return;
      }

      const nextOfferings: GroupOffering[] = [
        buildOffering({
          type: "saludo",
          draft: workingDraft.saludo,
          displayOrder: 1,
        }),
        buildOffering({
          type: "consejo",
          draft: workingDraft.consejo,
          displayOrder: 2,
        }),
        buildOffering({
          type: "meet_greet_digital",
          draft: workingDraft.meetGreet,
          displayOrder: 3,
          meta: {
            meetGreet: {
              durationMinutes: workingDraft.meetGreet.enabled
                ? meetGreetDurationNum
                : null,
            },
          },
        }),
        buildOffering({
          type: "clase_personalizada",
          draft: workingDraft.customClass,
          displayOrder: 4,
          meta: {
            customClass: {
              durationMinutes: workingDraft.customClass.enabled
                ? customClassDurationNum
                : null,
              availability: createEmptyWeeklyAvailability() as unknown as CustomClassWeeklyAvailability,
            },
          },
        }),
      ];

      const nextDonation: GroupDonationSettings = {
        mode: workingDraft.donationMode,
        enabled: workingDraft.donationMode !== "none",
        visible: workingDraft.donationMode !== "none",
        currency:
          workingDraft.donationMode !== "none" ? workingDraft.donationCurrency : "MXN",
        sourceScope: "group",
        suggestedAmounts:
          workingDraft.donationMode !== "none" && donationMinimumNum != null
            ? [donationMinimumNum]
            : [],
        goalLabel: workingDraft.donationGoalLabel.trim() || null,
        message: workingDraft.donationMessage.trim() || null,
        videoUrl: workingDraft.donationVideoUrl || null,
        playbackId: workingDraft.donationPlaybackId || null,
      };

      const preservedPaidPostsEnabled =
        typeof currentMonetization?.paidPostsEnabled === "boolean"
          ? currentMonetization.paidPostsEnabled
          : false;

      const preservedPaidLivesEnabled =
        typeof currentMonetization?.paidLivesEnabled === "boolean"
          ? currentMonetization.paidLivesEnabled
          : false;

      const preservedPaidVodEnabled =
        typeof currentMonetization?.paidVodEnabled === "boolean"
          ? currentMonetization.paidVodEnabled
          : false;

      const preservedPaidLiveCommentsEnabled =
        typeof currentMonetization?.paidLiveCommentsEnabled === "boolean"
          ? currentMonetization.paidLiveCommentsEnabled
          : false;

      const isTransitioningSubscriptionModel =
        localWillEnableSubscription ||
        localWillDisableSubscription ||
        localWillIncreaseSubscriptionPrice;

      const nextTransitions = {
        freeToSubscriptionPolicy:
          localWillEnableSubscription && workingDraft.freeToSubscriptionPolicy
            ? workingDraft.freeToSubscriptionPolicy
            : currentMonetization?.transitions?.freeToSubscriptionPolicy ?? null,
        subscriptionToFreePolicy:
          localWillDisableSubscription && workingDraft.subscriptionToFreePolicy
            ? workingDraft.subscriptionToFreePolicy
            : currentMonetization?.transitions?.subscriptionToFreePolicy ?? null,
        subscriptionPriceIncreasePolicy:
          localWillIncreaseSubscriptionPrice &&
          workingDraft.subscriptionPriceIncreasePolicy
            ? workingDraft.subscriptionPriceIncreasePolicy
            : currentMonetization?.transitions?.subscriptionPriceIncreasePolicy ??
              null,
        previousSubscriptionPriceMonthly: localWillIncreaseSubscriptionPrice
          ? savedPrevSubscriptionPrice
          : currentMonetization?.transitions?.previousSubscriptionPriceMonthly ??
            null,
        nextSubscriptionPriceMonthly: localWillIncreaseSubscriptionPrice
          ? localNextSubscriptionPrice
          : currentMonetization?.transitions?.nextSubscriptionPriceMonthly ??
            null,
        subscriptionPriceChangeCurrency: localWillIncreaseSubscriptionPrice
          ? workingDraft.subscription.currency
          : currentMonetization?.transitions?.subscriptionPriceChangeCurrency ??
            null,
        lastMonetizationChangeAt: (isTransitioningSubscriptionModel
          ? serverTimestamp()
          : currentMonetization?.transitions?.lastMonetizationChangeAt ?? null) as unknown as import("firebase/firestore").Timestamp | null,
        lastMonetizationChangeBy: isTransitioningSubscriptionModel
          ? currentUserId
          : currentMonetization?.transitions?.lastMonetizationChangeBy ?? null,
      };

      const nextMonetization = {
        isPaid: isPublic ? false : workingDraft.subscription.enabled,
        priceMonthly:
          isPublic || !workingDraft.subscription.enabled ? null : subscriptionPriceNum,
        currency:
          isPublic || !workingDraft.subscription.enabled
            ? null
            : workingDraft.subscription.currency,

        subscriptionsEnabled: isPublic ? false : workingDraft.subscription.enabled,
        subscriptionPriceMonthly:
          isPublic || !workingDraft.subscription.enabled ? null : subscriptionPriceNum,
        subscriptionCurrency:
          isPublic || !workingDraft.subscription.enabled
            ? null
            : workingDraft.subscription.currency,

        paidPostsEnabled: preservedPaidPostsEnabled,
        paidLivesEnabled: preservedPaidLivesEnabled,
        paidVodEnabled: preservedPaidVodEnabled,
        paidLiveCommentsEnabled: preservedPaidLiveCommentsEnabled,

        greetingsEnabled: workingDraft.saludo.enabled,
        adviceEnabled: workingDraft.consejo.enabled,
        customClassEnabled: workingDraft.customClass.enabled,
        digitalMeetGreetEnabled: workingDraft.meetGreet.enabled,

        transitions: nextTransitions,
      };

      const commerce = buildNormalizedGroupCommerceState({
        offerings: nextOfferings,
        monetization: nextMonetization as Parameters<typeof buildNormalizedGroupCommerceState>[0]["monetization"],
        donation: nextDonation,
        legacyGreetingsEnabled: workingDraft.saludo.enabled,
        currency:
          (!isPublic && workingDraft.subscription.enabled
            ? workingDraft.subscription.currency
            : workingDraft.saludo.currency) ?? "MXN",
      });

      skipHydrationWhileSavingRef.current = true;

      await updateDoc(doc(db, "groups", groupId), {
        monetization: {
          ...commerce.monetization,
          transitions: nextTransitions,
        },
        offerings: commerce.offerings,
        donation: commerce.donation,
        greetingsEnabled: commerce.monetization.greetingsEnabled,
      });

      let successMessage =
        "✅ Configuración de suscripción, catálogo y donación guardados.";

      if (isTransitioningSubscriptionModel) {
        try {
          const transitionResponse = await applyGroupSubscriptionTransition({
            groupId,
            nextSubscriptionEnabled: !isPublic && workingDraft.subscription.enabled,
            freeToSubscriptionPolicy:
              localWillEnableSubscription && workingDraft.freeToSubscriptionPolicy
                ? workingDraft.freeToSubscriptionPolicy
                : undefined,
            subscriptionToFreePolicy:
              localWillDisableSubscription && workingDraft.subscriptionToFreePolicy
                ? workingDraft.subscriptionToFreePolicy
                : undefined,
            subscriptionPriceIncreasePolicy:
              localWillIncreaseSubscriptionPrice &&
              workingDraft.subscriptionPriceIncreasePolicy
                ? workingDraft.subscriptionPriceIncreasePolicy
                : undefined,
            previousSubscriptionPriceMonthly:
              localWillIncreaseSubscriptionPrice
                ? savedPrevSubscriptionPrice
                : undefined,
            nextSubscriptionPriceMonthly:
              localWillIncreaseSubscriptionPrice
                ? localNextSubscriptionPrice
                : undefined,
            subscriptionPriceChangeCurrency:
              localWillIncreaseSubscriptionPrice
                ? workingDraft.subscription.currency
                : undefined,
          });

          successMessage = buildTransitionSuccessMessage(transitionResponse);
        } catch (transitionError: unknown) {
          const transitionMessage =
            (transitionError instanceof Error ? transitionError.message : null) ??
            "La transición de miembros no pudo completarse.";

          const nextSavedAfterPartialSuccess: ServiceDraft = {
            subscription: {
              enabled: isPublic ? false : workingDraft.subscription.enabled,
              price:
                isPublic || !workingDraft.subscription.enabled
                  ? ""
                  : workingDraft.subscription.price,
              currency:
                isPublic || !workingDraft.subscription.enabled
                  ? "MXN"
                  : workingDraft.subscription.currency,
            },
            saludo: {
              ...workingDraft.saludo,
              price: workingDraft.saludo.enabled ? workingDraft.saludo.price : "",
              visible: workingDraft.saludo.enabled ? workingDraft.saludo.visible : false,
              visibility: "members",
            },
            consejo: {
              ...workingDraft.consejo,
              price: workingDraft.consejo.enabled ? workingDraft.consejo.price : "",
              visible: workingDraft.consejo.enabled ? workingDraft.consejo.visible : false,
              visibility: "members",
            },
            meetGreet: {
              ...workingDraft.meetGreet,
              price: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.price : "",
              visible: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.visible : false,
              visibility: "members",
              durationMinutes: workingDraft.meetGreet.enabled
                ? workingDraft.meetGreet.durationMinutes
                : "",
            },
            customClass: {
              ...workingDraft.customClass,
              price: workingDraft.customClass.enabled ? workingDraft.customClass.price : "",
              visible: workingDraft.customClass.enabled
                ? workingDraft.customClass.visible
                : false,
              visibility: "members",
              durationMinutes: workingDraft.customClass.enabled
                ? workingDraft.customClass.durationMinutes
                : "",
              availability: createEmptyWeeklyAvailability(),
            },
            donationMode: workingDraft.donationMode,
            donationCurrency:
              workingDraft.donationMode !== "none" ? workingDraft.donationCurrency : "MXN",
            donationMinimumAmount:
              workingDraft.donationMode !== "none"
                ? workingDraft.donationMinimumAmount
                : "",
            donationGoalLabel: workingDraft.donationGoalLabel,
            donationMessage: workingDraft.donationMessage,
            donationVideoUrl: workingDraft.donationVideoUrl,
            donationPlaybackId: workingDraft.donationPlaybackId,
            freeToSubscriptionPolicy: workingDraft.freeToSubscriptionPolicy,
            subscriptionToFreePolicy: workingDraft.subscriptionToFreePolicy,
            subscriptionPriceIncreasePolicy:
              workingDraft.subscriptionPriceIncreasePolicy,
          };

          setDraft(nextSavedAfterPartialSuccess);
          setSavedDraft(nextSavedAfterPartialSuccess);
          showAdminServicesToast(
            `⚠️ La configuración del grupo sí se guardó, pero la transición de miembros no terminó correctamente: ${transitionMessage}`,
            "warning"
          );
          return;
        }
      }

      const nextSaved: ServiceDraft = {
        subscription: {
          enabled: isPublic ? false : workingDraft.subscription.enabled,
          price:
            isPublic || !workingDraft.subscription.enabled
              ? ""
              : workingDraft.subscription.price,
          currency:
            isPublic || !workingDraft.subscription.enabled
              ? "MXN"
              : workingDraft.subscription.currency,
        },
        saludo: {
          ...workingDraft.saludo,
          price: workingDraft.saludo.enabled ? workingDraft.saludo.price : "",
          visible: workingDraft.saludo.enabled ? workingDraft.saludo.visible : false,
          visibility: "members",
        },
        consejo: {
          ...workingDraft.consejo,
          price: workingDraft.consejo.enabled ? workingDraft.consejo.price : "",
          visible: workingDraft.consejo.enabled ? workingDraft.consejo.visible : false,
          visibility: "members",
        },
        meetGreet: {
          ...workingDraft.meetGreet,
          price: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.price : "",
          visible: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.visible : false,
          visibility: "members",
          durationMinutes: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.durationMinutes
            : "",
        },
        customClass: {
          ...workingDraft.customClass,
          price: workingDraft.customClass.enabled ? workingDraft.customClass.price : "",
          visible: workingDraft.customClass.enabled ? workingDraft.customClass.visible : false,
          visibility: "members",
          durationMinutes: workingDraft.customClass.enabled
            ? workingDraft.customClass.durationMinutes
            : "",
          availability: createEmptyWeeklyAvailability(),
        },
        donationMode: workingDraft.donationMode,
        donationCurrency:
          workingDraft.donationMode !== "none" ? workingDraft.donationCurrency : "MXN",
        donationMinimumAmount:
          workingDraft.donationMode !== "none" ? workingDraft.donationMinimumAmount : "",
        donationGoalLabel: workingDraft.donationGoalLabel,
        donationMessage: workingDraft.donationMessage,
        donationVideoUrl: workingDraft.donationVideoUrl,
        donationPlaybackId: workingDraft.donationPlaybackId,
        freeToSubscriptionPolicy: workingDraft.freeToSubscriptionPolicy,
        subscriptionToFreePolicy: workingDraft.subscriptionToFreePolicy,
        subscriptionPriceIncreasePolicy:
          workingDraft.subscriptionPriceIncreasePolicy,
      };

      setDraft(nextSaved);
      setSavedDraft(nextSaved);
      showAdminServicesToast(successMessage);
    } catch (e: unknown) {
      showAdminServicesToast((e instanceof Error ? e.message : null) ?? "❌ No se pudieron guardar los servicios.", "error");
    } finally {
      skipHydrationWhileSavingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div style={contentStyle}>
      <div id="admin-subscription" style={{ scrollMarginTop: 80 }}>
      <Subscription
        draft={draft}
        savedDraft={savedDraft}
        isPublic={isPublic}
        saving={saving}
        removingLegacyMembers={removingLegacyMembers}
        activeLegacyFreeMembersCount={activeLegacyFreeMembersCount}
        canRemoveLegacyFreeMembersLater={canRemoveLegacyFreeMembersLater}
        subscriptionEmoji={SERVICE_EMOJIS.subscription}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        ConfirmModalComponent={ConfirmModal}
        SpinningGearComponent={SpinningGear}
        onSaveDraft={saveServicesFromDraft}
        onRemoveLegacyMembers={handleConfirmRemoveLegacyFreeMembersLater}
      />
      </div>

      <Greetings
        draft={draft}
        saving={saving}
        saludoEmoji={SERVICE_EMOJIS.saludo}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <Advice
        draft={draft}
        saving={saving}
        consejoEmoji={SERVICE_EMOJIS.consejo}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <MeetGreet
        draft={draft}
        saving={saving}
        meetGreetEmoji={SERVICE_EMOJIS.meetGreet}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <CustomClass
        draft={draft}
        saving={saving}
        customClassEmoji={SERVICE_EMOJIS.customClass}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <Donation
        draft={draft}
        savedDraft={savedDraft}
        saving={saving}
        removingLegacyMembers={removingLegacyMembers}
        donationEmoji={SERVICE_EMOJIS.donation}
        groupId={groupId}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        OverlayModalComponent={OverlayModal}
        DonationModeButtonComponent={DonationModeButton}
        SwitchComponent={Switch}
        onSaveDraft={saveServicesFromDraft}
      />

      <VibraToast toast={adminServicesToast} />
    </div>
  );
}