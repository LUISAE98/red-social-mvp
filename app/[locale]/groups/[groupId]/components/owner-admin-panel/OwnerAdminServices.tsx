"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { AVISOS_SERVICIOS } from "@/lib/services/avisosServicios";
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

import Subscription from "@/components/services/config/Subscription";
import Greetings from "@/components/services/config/Greetings";
import Advice from "@/components/services/config/Advice";
import MeetGreet from "@/components/services/config/MeetGreet";
import CustomClass from "@/components/services/config/CustomClass";
import {
  SERVICE_EMOJIS, SpinningGear, DonationModeButton,
  buildManualLegacyRemovalSuccessMessage, buildOffering, buildServiceBlockDraft,
  type AvisoTransicion,
  buildSubscriptionDraft, buildTransitionSuccessMessage, calcNetAmount,
  createEmptyDraft, createEmptyWeeklyAvailability, normalizeDurationMeta,
  normalizeWeeklyAvailabilityFromMeta, pickDonation, pickOffering,
  pickSubscription, pickTransitions, sameDraft,
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  type Props, type ServiceDraft,
} from "./OwnerAdminServices.parts";
import { ConfirmModal } from "./OwnerAdminServices.modals";

// Kit visual COMPARTIDO con el perfil: mismos overlays con imagen de fondo, switch,
// colores de acento y estilos → los cards de configuración quedan idénticos a los del
// perfil. La donación usa el MISMO componente compartido (scope="group").
import DonationConfigCard from "@/components/services/config/DonationConfigCard";
import {
  SaludoOverlay, ConsejoOverlay, MeetGreetOverlay, CustomClassOverlay, DonationOverlay, SubscriptionOverlay,
  Switch as RichSwitch, SERVICE_COLORS, makeServiceConfigStyles, makeServicePanelStyle,
  MEET_GREET_MIN_MINUTES, MEET_GREET_MAX_MINUTES,
  CUSTOM_CLASS_MIN_MINUTES, CUSTOM_CLASS_MAX_MINUTES,
} from "@/components/services/config/serviceConfigKit";
import { BRAND_DOMAIN } from "@/lib/brand";

export default function OwnerAdminServices({
  groupId,
  ownerId,
  currentUserId,
  currentVisibility = null,
  currentMonetization = null,
  currentOfferings = null,
  currentDonation = null,
  onChangeVisibility,
}: Props) {
  const tServices = useTranslations("services");

  /** Compone el aviso de la transición: la frase y, si la hay, su cola de contadores. */
  const textoAvisoTransicion = (aviso: AvisoTransicion) => {
    const frase = tServices(aviso.clave as Parameters<typeof tServices>[0]);
    if (!aviso.cola) return frase;
    return frase + " " + tServices(aviso.cola.clave as Parameters<typeof tServices>[0], aviso.cola.valores);
  };
  const priceFmt = usePriceFormat();
  // 🚨 `formatPlain`, NO `format` — ver el mismo comentario en ProfileServicesTab.
  const formatMoney = (value: number, currency?: string) =>
    priceFmt.formatPlain(value, { baseCurrency: currency ?? SETTLEMENT_CURRENCY, code: true });

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
        currency: sub.currency ?? SETTLEMENT_CURRENCY,
      }),
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? SETTLEMENT_CURRENCY,
        visible: saludo.enabled,
        visibility: "members",
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? SETTLEMENT_CURRENCY,
        visible: consejo.enabled,
        visibility: "members",
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? SETTLEMENT_CURRENCY,
          visible: meetGreet.enabled,
          visibility: "members",
        }),
        durationMinutes: normalizeDurationMeta(meetGreet.meta, "meetGreet"),
      },
      customClass: {
        ...buildServiceBlockDraft({
          enabled: customClass.enabled,
          price: customClass.price,
          currency: customClass.currency ?? SETTLEMENT_CURRENCY,
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
      donationCurrency: donation.currency ?? SETTLEMENT_CURRENCY,
      donationSuggestedAmounts: donation.suggestedAmounts,
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
    gap: 8,
    // Los hijos de una rejilla usan min-width:auto: sin esto, un precio largo
    // estira la pista y saca la tarjeta por la derecha. Se nota más aquí porque
    // las cards llevan margen negativo para ir de lado a lado.
    minWidth: 0,
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

  // Estilos e imágenes de fondo compartidos con el perfil (mismos cards de servicio).
  const richStyles = makeServiceConfigStyles();
  // Panel activo de suscripción: mismo formato que las demás cards activas, con su
  // propia imagen de fondo (suscripciones.webp).
  const subscriptionActivePanel = makeServicePanelStyle(
    richStyles.panelStyle,
    "/suscripciones.webp",
    "center"
  );
  const groupPublishSuccess = {
    shareUrl: `https://${BRAND_DOMAIN}/groups/${groupId}`,
    entityKind: "community" as const,
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
        textoAvisoTransicion(
          buildManualLegacyRemovalSuccessMessage({
            removedMembers: response.removedMembers,
            reminderMembers: response.reminderMembers,
            skippedMembers: response.skippedMembers,
          })
        ),
        "success"
      );
    } catch (e: unknown) {
      showAdminServicesToast(
        (e instanceof Error ? e.message : null) ??
          tServices("freeMembersRemoveError"),
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

      const donationSuggestedNums =
        workingDraft.donationSuggestedAmounts.map((s) => Number(s));

      if (
        workingDraft.subscription.enabled &&
        (subscriptionPriceNum == null ||
          Number.isNaN(subscriptionPriceNum) ||
          subscriptionPriceNum <= 0)
      ) {
        setErr(tServices(AVISOS_SERVICIOS.precioSuscripcion));
        return;
      }

      if (
        workingDraft.saludo.enabled &&
        (saludoPriceNum == null ||
          Number.isNaN(saludoPriceNum) ||
          saludoPriceNum <= 0)
      ) {
        setErr(tServices(AVISOS_SERVICIOS.precioSaludos));
        return;
      }

      if (
        workingDraft.consejo.enabled &&
        (consejoPriceNum == null ||
          Number.isNaN(consejoPriceNum) ||
          consejoPriceNum <= 0)
      ) {
        setErr(tServices(AVISOS_SERVICIOS.precioConsejos));
        return;
      }

      if (
        workingDraft.meetGreet.enabled &&
        (meetGreetPriceNum == null ||
          Number.isNaN(meetGreetPriceNum) ||
          meetGreetPriceNum <= 0)
      ) {
        setErr(tServices(AVISOS_SERVICIOS.precioMeetGreet));
        return;
      }

      if (
        workingDraft.customClass.enabled &&
        (customClassPriceNum == null ||
          Number.isNaN(customClassPriceNum) ||
          customClassPriceNum <= 0)
      ) {
        setErr(tServices(AVISOS_SERVICIOS.precioSesion));
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
          tServices(AVISOS_SERVICIOS.duracionMeetGreet)
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
          tServices(AVISOS_SERVICIOS.duracionSesion)
        );
        return;
      }

      if (isPublic && workingDraft.subscription.enabled) {
        setErr(
          tServices("subscriptionPublicDisabledToast")
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
          tServices("transitionFreeToPaid")
        );
        return;
      }

      if (localWillDisableSubscription && !workingDraft.subscriptionToFreePolicy) {
        setErr(
          tServices("transitionPaidToFree")
        );
        return;
      }

      if (
        localWillIncreaseSubscriptionPrice &&
        !workingDraft.subscriptionPriceIncreasePolicy
      ) {
        setErr(
          tServices("transitionPriceUp")
        );
        return;
      }

      if (
        workingDraft.donationMode !== "none" &&
        (donationSuggestedNums.length !== 4 ||
          donationSuggestedNums.some((n) => !Number.isFinite(n) || n < 50))
      ) {
        setErr(tServices(AVISOS_SERVICIOS.donacionMontoMinimo));
        return;
      }

      if (
        workingDraft.donationMode === "wedding" &&
        !workingDraft.donationGoalLabel.trim()
      ) {
        setErr(tServices(AVISOS_SERVICIOS.donacionTextoBoda));
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
          workingDraft.donationMode !== "none" ? donationSuggestedNums : [],
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
            : workingDraft.saludo.currency) ?? SETTLEMENT_CURRENCY,
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
        tServices("configAllSaved");

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

          successMessage = textoAvisoTransicion(buildTransitionSuccessMessage(transitionResponse));
        } catch (transitionError: unknown) {
          const transitionMessage =
            (transitionError instanceof Error ? transitionError.message : null) ??
            tServices("transitionFailed");

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
            donationSuggestedAmounts:
              workingDraft.donationMode !== "none"
                ? workingDraft.donationSuggestedAmounts
                : [...DEFAULT_DONATION_SUGGESTED_AMOUNTS],
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
            tServices("transitionPartial", { detail: transitionMessage }),
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
        donationSuggestedAmounts:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationSuggestedAmounts
            : [...DEFAULT_DONATION_SUGGESTED_AMOUNTS],
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
      return true;
    } catch (e: unknown) {
      showAdminServicesToast((e instanceof Error ? e.message : null) ?? tServices(AVISOS_SERVICIOS.noGuardado), "error");
      return false;
    } finally {
      skipHydrationWhileSavingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <style jsx>{`
        /* En celular, el margen lateral de esta pestaña lo da ÚNICAMENTE este
           contenedor (transparente), igual que en el perfil: así el contenido
           queda simétrico y centrado. */
        @media (max-width: 900px) {
          .services-tab-margins {
            padding-inline-start: 10px;
            padding-inline-end: 10px;
          }
        }
        /* En celular cada card de experiencia llega de lado a lado (full-bleed):
           se anula EXACTAMENTE el padding lateral de .services-tab-margins (10px),
           quedando edge-to-edge y SIMÉTRICO (sin depender de 50vw, que con el
           scrollbar-gutter descentraba). El heading queda inset. (La suscripción no
           lleva la clase serviceActivationPanel, así que se queda inset.) */
        @media (max-width: 900px) {
          .services-tab-margins :global(.serviceActivationPanel) {
            margin-inline-start: -10px;
            margin-inline-end: -10px;
          }
        }
      `}</style>
      <div className="services-tab-margins" style={contentStyle}>
      <h2
        style={{
          margin: "0 0 7px",
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1.2,
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        Configura tus experiencias
      </h2>
      <div id="admin-subscription" style={{ scrollMarginTop: 80 }}>
      <Subscription
        draft={draft}
        savedDraft={savedDraft}
        isPublic={isPublic}
        onChangeVisibility={onChangeVisibility}
        saving={saving}
        removingLegacyMembers={removingLegacyMembers}
        activeLegacyFreeMembersCount={activeLegacyFreeMembersCount}
        canRemoveLegacyFreeMembersLater={canRemoveLegacyFreeMembersLater}
        panelStyle={draft.subscription.enabled ? subscriptionActivePanel : richStyles.plainPanelStyle}
        titleStyle={richStyles.titleStyle}
        subtleStyle={richStyles.subtleStyle}
        descriptionStyle={richStyles.descriptionStyle}
        inputStyle={richStyles.inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={RichSwitch}
        OverlayModalComponent={SubscriptionOverlay}
        ConfirmModalComponent={ConfirmModal}
        SpinningGearComponent={SpinningGear}
        onSaveDraft={async (d) => { await saveServicesFromDraft(d); }}
        onRemoveLegacyMembers={handleConfirmRemoveLegacyFreeMembersLater}
      />
      </div>

      <Greetings
        draft={draft}
        saving={saving}
        saludoEmoji={SERVICE_EMOJIS.saludo}
        accentColor={SERVICE_COLORS.saludo}
        showDescription
        descriptionStyle={richStyles.descriptionStyle}
        panelStyle={draft.saludo.enabled ? richStyles.servicePanelStyles.saludo : richStyles.plainPanelStyle}
        titleStyle={richStyles.titleStyle}
        subtleStyle={richStyles.subtleStyle}
        inputStyle={richStyles.inputStyle}
        buttonSecondaryStyle={richStyles.buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={RichSwitch}
        OverlayModalComponent={SaludoOverlay}
        publishSuccess={groupPublishSuccess}
        onSaveDraft={saveServicesFromDraft}
      />

      <Advice
        draft={draft}
        saving={saving}
        consejoEmoji={SERVICE_EMOJIS.consejo}
        accentColor={SERVICE_COLORS.consejo}
        showDescription
        descriptionStyle={richStyles.descriptionStyle}
        panelStyle={draft.consejo.enabled ? richStyles.servicePanelStyles.consejo : richStyles.plainPanelStyle}
        titleStyle={richStyles.titleStyle}
        subtleStyle={richStyles.subtleStyle}
        inputStyle={richStyles.inputStyle}
        buttonSecondaryStyle={richStyles.buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={RichSwitch}
        OverlayModalComponent={ConsejoOverlay}
        publishSuccess={groupPublishSuccess}
        onSaveDraft={saveServicesFromDraft}
      />

      <MeetGreet
        draft={draft}
        saving={saving}
        meetGreetEmoji={SERVICE_EMOJIS.meetGreet}
        accentColor={SERVICE_COLORS.meetGreet}
        showDescription
        descriptionStyle={richStyles.descriptionStyle}
        panelStyle={draft.meetGreet.enabled ? richStyles.servicePanelStyles.meetGreet : richStyles.plainPanelStyle}
        titleStyle={richStyles.titleStyle}
        subtleStyle={richStyles.subtleStyle}
        inputStyle={richStyles.inputStyle}
        buttonSecondaryStyle={richStyles.buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={RichSwitch}
        OverlayModalComponent={MeetGreetOverlay}
        publishSuccess={groupPublishSuccess}
        durationMin={MEET_GREET_MIN_MINUTES}
        durationMax={MEET_GREET_MAX_MINUTES}
        onSaveDraft={saveServicesFromDraft}
      />

      <CustomClass
        draft={draft}
        saving={saving}
        customClassEmoji={SERVICE_EMOJIS.customClass}
        accentColor={SERVICE_COLORS.customClass}
        showDescription
        descriptionStyle={richStyles.descriptionStyle}
        panelStyle={draft.customClass.enabled ? richStyles.servicePanelStyles.customClass : richStyles.plainPanelStyle}
        titleStyle={richStyles.titleStyle}
        subtleStyle={richStyles.subtleStyle}
        inputStyle={richStyles.inputStyle}
        buttonSecondaryStyle={richStyles.buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={RichSwitch}
        OverlayModalComponent={CustomClassOverlay}
        publishSuccess={groupPublishSuccess}
        durationMin={CUSTOM_CLASS_MIN_MINUTES}
        durationMax={CUSTOM_CLASS_MAX_MINUTES}
        onSaveDraft={saveServicesFromDraft}
      />

      <DonationConfigCard
        draft={draft}
        saving={saving}
        scope="group"
        entityId={groupId}
        accentColor={SERVICE_COLORS.donation}
        descriptionStyle={richStyles.descriptionStyle}
        panelStyle={draft.donationMode !== "none" ? richStyles.servicePanelStyles.donation : richStyles.plainPanelStyle}
        titleStyle={richStyles.titleStyle}
        subtleStyle={richStyles.subtleStyle}
        inputStyle={richStyles.inputStyle}
        buttonSecondaryStyle={richStyles.buttonSecondaryStyle}
        SwitchComponent={RichSwitch}
        DonationModeButtonComponent={DonationModeButton}
        OverlayModalComponent={DonationOverlay}
        publishSuccess={groupPublishSuccess}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />

      <VibraToast toast={adminServicesToast} />
      </div>
    </>
  );
}