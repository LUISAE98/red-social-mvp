"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/currency/format";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import GreetingReviewOverlay from "@/app/components/OwnerSidebar/GreetingReviewOverlay";
import SampleRequestPanel, { type SampleRequestDraft } from "@/components/services/config/SampleRequestPanel";
import { BRAND_DOMAIN } from "@/lib/brand";
import { AVISOS_SERVICIOS } from "@/lib/services/avisosServicios";

import Greetings from "@/components/services/config/Greetings";
import Advice from "@/components/services/config/Advice";
import MeetGreet from "@/components/services/config/MeetGreet";
import CustomClass from "@/components/services/config/CustomClass";
import ProfileDonation from "./ProfileDonation";

import { updateProfileOfferings } from "@/lib/profile/updateProfileOfferings";
import { SETTLEMENT_CURRENCY, DONATION_MIN_AMOUNT_USD } from "@/lib/currency/catalog";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import type { DisplayCurrency } from "@/lib/currency/catalog";

import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  DonationMode,
  GroupDonationSettings,
  GroupOffering,
} from "@/types/group";
import {
  CUSTOM_CLASS_MAX_MINUTES, CUSTOM_CLASS_MIN_MINUTES,
  MEET_GREET_MAX_MINUTES, MEET_GREET_MIN_MINUTES,
  SERVICE_COLORS, SERVICE_EMOJIS,
  ConsejoOverlay, CustomClassOverlay, DonationModeButton, DonationOverlay,
  MeetGreetOverlay, SaludoOverlay, Switch,
  buildOffering, buildServiceBlockDraft, calcNetAmount, createEmptyDraft,
  createEmptyWeeklyAvailability, normalizeDurationMeta, pickDonation, pickOffering,
  sameDraft,
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  type Props, type ServiceDraft,
} from "./ProfileServicesTab.parts";

export default function ProfileServicesTab({
  profileUserId,
  currentUserId,
  currentOfferings = null,
  currentDonation = null,
  onProfileServicesChanged,
}: Props) {
  const tServices = useTranslations("services");

  const isOwner = useMemo(
    () => profileUserId === currentUserId,
    [profileUserId, currentUserId]
  );

  const priceFmt = usePriceFormat();
  // 🚨 NO CONVIERTE, y es deliberado. Todo lo que se formatea aquí es dinero del CREADOR,
  // que se fija y se guarda en la moneda de LIQUIDACIÓN: su precio y su ganancia. Pasarlo
  // por una conversión mostraba su ganancia de 75 USD como "1,279.55 MXN", que no es lo que
  // gana ni lo que fijó. La referencia en su moneda va aparte, en `LocalPriceHint`.
  const formatMoney = (value: number, currency?: string) =>
    formatCurrency(value, currency ?? SETTLEMENT_CURRENCY, priceFmt.locale, { code: true });

  // Link público del perfil (para el botón "Copiar link" de la vista de éxito).
  const routeParams = useParams<{ handle?: string }>();
  const profileHandle = Array.isArray(routeParams?.handle)
    ? routeParams.handle[0]
    : routeParams?.handle;
  const profileShareUrl = profileHandle
    ? `https://${BRAND_DOMAIN}/u/${profileHandle}`
    : "";
  const publishSuccessConfig = { shareUrl: profileShareUrl, entityKind: "profile" as const };

  const [draft, setDraft] = useState<ServiceDraft>(createEmptyDraft());
  // `savedDraft` es lo último que se sabe guardado. Se compara contra el
  // borrador vivo para no pisar ediciones sin guardar cuando llega un snapshot.
  const [savedDraft, setSavedDraft] = useState<ServiceDraft>(createEmptyDraft());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (err) showToast(err, "error"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grabador de muestras: guarda qué servicio se está ejemplificando.
  const [sampleType, setSampleType] = useState<"saludo" | "consejo" | null>(null);
  // La solicitud inventada. Hasta que no está escrita no se abre el grabador:
  // sin ella el panel no tendría qué enseñar en pantalla mientras grabas.
  const [sampleDraft, setSampleDraft] = useState<SampleRequestDraft | null>(null);
  // Cambia con cada "grabar uno más" para REMONTAR el grabador. Sin esto se
  // quedaba con la muestra anterior ya enviada y no volvía a la cámara.
  const [sampleRun, setSampleRun] = useState(0);

  const lastHydratedProfileIdRef = useRef<string | null>(null);
  const skipHydrationWhileSavingRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    if (skipHydrationWhileSavingRef.current) return;

    const saludo = pickOffering(currentOfferings, "saludo");
    const consejo = pickOffering(currentOfferings, "consejo");
    const meetGreet = pickOffering(currentOfferings, "meet_greet_digital");
    const customClass = pickOffering(currentOfferings, "clase_personalizada");
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscription: {
        enabled: false,
        price: "",
        currency: SETTLEMENT_CURRENCY,
      },
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? SETTLEMENT_CURRENCY,
        visible: saludo.enabled,
        visibility: "public",
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? SETTLEMENT_CURRENCY,
        visible: consejo.enabled,
        visibility: "public",
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? SETTLEMENT_CURRENCY,
          visible: meetGreet.enabled,
          visibility: "public",
        }),
        durationMinutes: normalizeDurationMeta(meetGreet.meta, "meetGreet"),
      },
      customClass: {
        ...buildServiceBlockDraft({
          enabled: customClass.enabled,
          price: customClass.price,
          currency: customClass.currency ?? SETTLEMENT_CURRENCY,
          visible: customClass.enabled,
          visibility: "public",
        }),
        durationMinutes: normalizeDurationMeta(
          customClass.meta,
          "customClass"
        ),
        availability: createEmptyWeeklyAvailability(),
      },
      donationMode: donation.mode,
      donationCurrency: donation.currency ?? SETTLEMENT_CURRENCY,
      donationSuggestedAmounts: donation.suggestedAmounts,
      donationGoalLabel: donation.goalLabel ?? "",
      donationMessage: donation.message,
      donationVideoUrl: donation.videoUrl ?? "",
      donationPlaybackId: donation.playbackId ?? "",
      freeToSubscriptionPolicy: "",
      subscriptionToFreePolicy: "",
      subscriptionPriceIncreasePolicy: "",
    };

    const isFirstHydrationForProfile =
      lastHydratedProfileIdRef.current !== profileUserId;

    if (isFirstHydrationForProfile) {
      lastHydratedProfileIdRef.current = profileUserId;
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setErr(null);
      return;
    }

    // 🚨 No pisar lo que se está editando.
    //
    // Este efecto se dispara cada vez que cambian `currentOfferings` o
    // `currentDonation`, que llegan del documento del perfil. Antes reemplazaba
    // el borrador siempre: si entraba un snapshot mientras escribías un precio,
    // te lo borraba. Es la misma guarda que ya tenía el panel de comunidad.
    setSavedDraft((prevSaved) =>
      sameDraft(prevSaved, nextDraft) ? prevSaved : nextDraft
    );

    setDraft((prevDraft) => {
      const hasUnsavedChanges = !sameDraft(prevDraft, savedDraft);
      return hasUnsavedChanges ? prevDraft : nextDraft;
    });
  }, [profileUserId, isOwner, currentOfferings, currentDonation, savedDraft]);

  if (!isOwner) return null;

  const fontStack =
    'inherit';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 8,
    // Sin esto los hijos de la rejilla usan min-width:auto y cualquier contenido
    // ancho (un precio largo, un nombre sin espacios) estira la pista y saca el
    // panel por la derecha en pantallas angostas.
    minWidth: 0,
  };

  const panelStyle: React.CSSProperties = {
    minWidth: 0,
    padding: "10px",
    borderRadius: 0,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 9,
  };

  // Panel con la misma imagen de fondo que se usa al presentar cada servicio
  // (ver CreatorExperiencesSection), sin contorno.
  const makeServicePanelStyle = (
    image: string,
    position: string
  ): React.CSSProperties => ({
    ...panelStyle,
    border: "none",
    padding: "14px",
    background: `linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('${image}') ${position}/cover no-repeat`,
  });

  const saludoPanelStyle = makeServicePanelStyle("/saludo.webp", "center 32%");
  const consejoPanelStyle = makeServicePanelStyle("/consejo.webp", "center 60%");
  const meetGreetPanelStyle = makeServicePanelStyle(
    "/encuentroenvivo.webp",
    "center 60%"
  );
  const customClassPanelStyle = makeServicePanelStyle(
    "/sesionexclusiva.webp",
    "center 75%"
  );
  const donationPanelStyle = makeServicePanelStyle("/donacion-perfil.webp", "center 50%");

  // Panel sin imagen de fondo, para servicios aún no activados.
  const plainPanelStyle: React.CSSProperties = {
    ...panelStyle,
    border: "none",
    padding: "14px",
    background: "transparent",
  };

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  // Descripción de cada experiencia: más legible que subtleStyle.
  const descriptionStyle: React.CSSProperties = {
    fontSize: 12.5,
    color: "rgba(255,255,255,0.82)",
    lineHeight: 1.4,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 15,
    color: "#fff",
    fontWeight: 500,
  };

  // Estilo de campos de texto (inputs/selects/textarea) según vibra_style.md:
  // fondo sutil sin borde, radio 12, padding 10/12, texto 13, sin outline.
  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    lineHeight: 1.5,
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

  async function saveServicesFromDraft(sourceDraft?: ServiceDraft) {
    setSaving(true);
    setErr(null);

    const workingDraft = sourceDraft ?? draft;

    try {
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
        workingDraft.meetGreet.enabled &&
        meetGreetDurationNum != null &&
        (meetGreetDurationNum < MEET_GREET_MIN_MINUTES ||
          meetGreetDurationNum > MEET_GREET_MAX_MINUTES)
      ) {
        showToast(
          tServices(AVISOS_SERVICIOS.rangoMinutos, { service: tServices("meetGreetNoun"), min: MEET_GREET_MIN_MINUTES, max: MEET_GREET_MAX_MINUTES }),
          "warning"
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

      if (
        workingDraft.customClass.enabled &&
        customClassDurationNum != null &&
        (customClassDurationNum < CUSTOM_CLASS_MIN_MINUTES ||
          customClassDurationNum > CUSTOM_CLASS_MAX_MINUTES)
      ) {
        showToast(
          tServices(AVISOS_SERVICIOS.rangoMinutos, { service: tServices("exclusiveSession"), min: CUSTOM_CLASS_MIN_MINUTES, max: CUSTOM_CLASS_MAX_MINUTES }),
          "warning"
        );
        return;
      }

      if (
        workingDraft.donationMode !== "none" &&
        (donationSuggestedNums.length !== 4 ||
          donationSuggestedNums.some((n) => !Number.isFinite(n) || n < DONATION_MIN_AMOUNT_USD))
      ) {
        setErr(tServices(AVISOS_SERVICIOS.donacionMontoMinimo, { min: DONATION_MIN_AMOUNT_USD }));
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
              availability: createEmptyWeeklyAvailability(),
              bufferMinutes: null,
              advanceBookingHours: null,
              maxBookingsPerDay: null,
            },
          },
        }),
      ];

      const nextDonation: GroupDonationSettings = {
        mode: workingDraft.donationMode,
        enabled: workingDraft.donationMode !== "none",
        visible: workingDraft.donationMode !== "none",
        currency:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationCurrency
            : "MXN",
        sourceScope: "profile",
        suggestedAmounts:
          workingDraft.donationMode !== "none" ? donationSuggestedNums : [],
        goalLabel: workingDraft.donationGoalLabel.trim() || null,
        message: workingDraft.donationMessage.trim() || null,
        videoUrl: workingDraft.donationVideoUrl || null,
        playbackId: workingDraft.donationPlaybackId || null,
      };

      skipHydrationWhileSavingRef.current = true;

      await updateProfileOfferings({
        profileUserId,
        offerings: nextOfferings,
        donation: nextDonation,
        currency: SETTLEMENT_CURRENCY,
      });

      const nextSaved: ServiceDraft = {
        ...workingDraft,
        subscription: {
          enabled: false,
          price: "",
          currency: SETTLEMENT_CURRENCY,
        },
        saludo: {
          ...workingDraft.saludo,
          price: workingDraft.saludo.enabled ? workingDraft.saludo.price : "",
          visible: workingDraft.saludo.enabled ? workingDraft.saludo.visible : false,
          visibility: "public",
        },
        consejo: {
          ...workingDraft.consejo,
          price: workingDraft.consejo.enabled ? workingDraft.consejo.price : "",
          visible: workingDraft.consejo.enabled ? workingDraft.consejo.visible : false,
          visibility: "public",
        },
        meetGreet: {
          ...workingDraft.meetGreet,
          price: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.price
            : "",
          visible: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.visible
            : false,
          visibility: "public",
          durationMinutes: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.durationMinutes
            : "",
        },
        customClass: {
          ...workingDraft.customClass,
          price: workingDraft.customClass.enabled
            ? workingDraft.customClass.price
            : "",
          visible: workingDraft.customClass.enabled
            ? workingDraft.customClass.visible
            : false,
          visibility: "public",
          durationMinutes: workingDraft.customClass.enabled
            ? workingDraft.customClass.durationMinutes
            : "",
          availability: createEmptyWeeklyAvailability(),
        },
        donationCurrency:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationCurrency
            : "MXN",
        donationSuggestedAmounts:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationSuggestedAmounts
            : [...DEFAULT_DONATION_SUGGESTED_AMOUNTS],
        donationGoalLabel:
          workingDraft.donationMode === "wedding"
            ? workingDraft.donationGoalLabel
            : "",
        donationVideoUrl: workingDraft.donationVideoUrl,
        donationPlaybackId: workingDraft.donationPlaybackId,
      };

            setDraft(nextSaved);
      setSavedDraft(nextSaved);

      onProfileServicesChanged?.({
        offerings: nextOfferings,
        donation: nextDonation,
      });

      showToast(tServices(AVISOS_SERVICIOS.guardado), "success");
      return true;
    } catch (e: unknown) {
      showToast(tServices(AVISOS_SERVICIOS.noGuardado), "error");
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
           contenedor (transparente): .profile-content va sin padding para
           servicios, así el contenido queda simétrico y centrado. En laptop el
           margen lo sigue dando .profile-content (aquí no se aplica). */
        /* Sin padding propio: el de .profile-content ya sirve, y añadir otro obligaba
           a que el contenedor se quedara sin el suyo (lo que movía la card de arriba
           al cambiar de pestaña). */
        /* En celular cada card de experiencia llega de lado a lado (full-bleed):
           se anula EXACTAMENTE el padding lateral de .services-tab-margins (10px),
           así queda edge-to-edge y SIMÉTRICO (sin depender de 50vw, que con el
           scrollbar-gutter descentraba). El heading queda inset. */
        @media (max-width: 900px) {
          .services-tab-margins :global(.serviceActivationPanel) {
            /* 12px = padding lateral de .profile-content en celular. Así la card
               llega al borde sin que el contenedor tenga que perder el suyo. */
            margin-inline-start: -12px;
            margin-inline-end: -12px;
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

      <div id="exp-saludo" style={{ scrollMarginTop: 80 }}>
      <Greetings
        draft={draft}
        saving={saving}
        saludoEmoji={SERVICE_EMOJIS.saludo}
        accentColor={SERVICE_COLORS.saludo}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.saludo.enabled ? saludoPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={SaludoOverlay}
        publishSuccess={publishSuccessConfig}
        onAddSample={() => setSampleType("saludo")}
        sampleCreatorId={profileUserId}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />
      </div>
      <div id="exp-consejo" style={{ scrollMarginTop: 80 }}>
      <Advice
        draft={draft}
        saving={saving}
        consejoEmoji={SERVICE_EMOJIS.consejo}
        accentColor={SERVICE_COLORS.consejo}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.consejo.enabled ? consejoPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={ConsejoOverlay}
        publishSuccess={publishSuccessConfig}
        onAddSample={() => setSampleType("consejo")}
        sampleCreatorId={profileUserId}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />
      </div>
      <div id="exp-meetGreet" style={{ scrollMarginTop: 80 }}>
      <MeetGreet
        draft={draft}
        saving={saving}
        meetGreetEmoji={SERVICE_EMOJIS.meetGreet}
        accentColor={SERVICE_COLORS.meetGreet}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.meetGreet.enabled ? meetGreetPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={MeetGreetOverlay}
        publishSuccess={publishSuccessConfig}
        durationMin={MEET_GREET_MIN_MINUTES}
        durationMax={MEET_GREET_MAX_MINUTES}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />
      </div>
      <div id="exp-customClass" style={{ scrollMarginTop: 80 }}>
      <CustomClass
        draft={draft}
        saving={saving}
        customClassEmoji={SERVICE_EMOJIS.customClass}
        accentColor={SERVICE_COLORS.customClass}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.customClass.enabled ? customClassPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={CustomClassOverlay}
        publishSuccess={publishSuccessConfig}
        durationMin={CUSTOM_CLASS_MIN_MINUTES}
        durationMax={CUSTOM_CLASS_MAX_MINUTES}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />
      </div>
      <div id="exp-donation" style={{ scrollMarginTop: 80 }}>
      <ProfileDonation
        draft={draft}
        saving={saving}
        profileUserId={profileUserId}
        panelStyle={draft.donationMode !== "none" ? donationPanelStyle : plainPanelStyle}
        accentColor={SERVICE_COLORS.donation}
        descriptionStyle={descriptionStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        SwitchComponent={Switch}
        DonationModeButtonComponent={DonationModeButton}
        OverlayModalComponent={DonationOverlay}
        publishSuccess={publishSuccessConfig}
        onSaveDraft={(d) => saveServicesFromDraft(d as ServiceDraft)}
      />
      </div>

      {/* Espacio al final para que el deep-link "Comenzar ahora" pueda centrar
          en pantalla incluso las últimas cards (si no, el scroll se topa con el
          fondo de la página y las de abajo se quedan cortas). */}
      <div aria-hidden="true" style={{ height: "55vh" }} />

      {/* Grabador de MUESTRAS.
          Reusa el mismo panel con el que el creador graba los saludos que ya le
          compraron. Se le pasa una solicitud SINTÉTICA: no existe en Firestore
          ni tiene comprador, solo lleva los ocho campos que el panel lee para
          pintarse. */}
      {/* Muestra en dos pasos. Primero el creador escribe la solicitud como si
          fuera quien se la pide; después se abre el MISMO grabador de siempre,
          en modo muestra: sin dinero y sin nada que rechazar. */}
      {/* El formulario va ENCIMA de la cámara, no antes: el grabador se monta
          a la vez y arranca la cámara solo, así que el creador escribe la
          solicitud viéndose ya en pantalla. */}
      {sampleType && !sampleDraft ? (
        <SampleRequestPanel
          type={sampleType}
          open
          zIndexBase={1000020}
          onCancel={() => { setSampleType(null); setSampleDraft(null); }}
          onSubmit={(draft) => setSampleDraft(draft)}
        />
      ) : null}

      {sampleType ? (
        <GreetingReviewOverlay
          key={`sample-${sampleType}-${sampleRun}`}
          sampleMode
          onRecordAnother={() => { setSampleDraft(null); setSampleRun((n) => n + 1); }}
          // Se abre DESDE el panel de configurar, que está en 999999. Sin subirlo
          // el grabador quedaba detrás.
          zIndex={1000000}
          items={[
            {
              id: `sample-${sampleType}`,
              data: {
                buyerId: "",
                creatorId: profileUserId,
                groupId: null,
                toName: "",
                instructions: sampleDraft?.instructions ?? "",
                muxPlaybackId: null,
                source: "profile",
                type: sampleType,
                videoDuration: null,
              },
            },
          ] as never}
          buyers={{}}
          greetingBusyId={null}
          onReject={() => { setSampleType(null); setSampleDraft(null); }}
          onClose={() => { setSampleType(null); setSampleDraft(null); }}
          getInitials={(name) => (name ?? "").trim().charAt(0).toUpperCase() || "?"}
          typeLabel={(t) => t}
        />
      ) : null}

      <VibraToast toast={toast} />
      </div>
    </>
  );
}