/**
 * Voz de Edge TTS para cada idioma de Vibra.
 *
 * ESTE ARCHIVO ESTÁ GENERADO. No se escribe a mano: son 46 idiomas por dos
 * voces, y un nombre mal copiado no falla al compilar — falla en producción,
 * cuando alguien le da a escuchar y no suena nada. Salió de la lista real que
 * publica el servicio (322 voces en 75 idiomas).
 *
 * Falta `dv` (dhivehi): el servicio no tiene ninguna voz para ese idioma. Quien
 * navegue en dhivehi oirá la voz de reserva.
 *
 * Dos voces por idioma —femenina y masculina— para poder elegir tono sin
 * volver a tocar esto.
 */

export type VozTts = { f: string; m: string };

/** locale de Vibra -> voces disponibles. */
export const VOCES_POR_LOCALE: Readonly<Record<string, VozTts>> = {
  "ar": { f: "ar-EG-SalmaNeural", m: "ar-EG-ShakirNeural" },
  "az": { f: "az-AZ-BanuNeural", m: "az-AZ-BabekNeural" },
  "bg": { f: "bg-BG-KalinaNeural", m: "bg-BG-BorislavNeural" },
  "bs": { f: "bs-BA-VesnaNeural", m: "bs-BA-GoranNeural" },
  "ca": { f: "ca-ES-JoanaNeural", m: "ca-ES-EnricNeural" },
  "cs": { f: "cs-CZ-VlastaNeural", m: "cs-CZ-AntoninNeural" },
  "da": { f: "da-DK-ChristelNeural", m: "da-DK-JeppeNeural" },
  "de": { f: "de-DE-SeraphinaMultilingualNeural", m: "de-DE-FlorianMultilingualNeural" },
  "el": { f: "el-GR-AthinaNeural", m: "el-GR-NestorasNeural" },
  "en": { f: "en-US-AvaNeural", m: "en-US-AndrewNeural" },
  "es": { f: "es-MX-DaliaNeural", m: "es-MX-JorgeNeural" },
  "et": { f: "et-EE-AnuNeural", m: "et-EE-KertNeural" },
  "fi": { f: "fi-FI-NooraNeural", m: "fi-FI-HarriNeural" },
  "fil": { f: "fil-PH-BlessicaNeural", m: "fil-PH-AngeloNeural" },
  "fr": { f: "fr-FR-VivienneMultilingualNeural", m: "fr-FR-RemyMultilingualNeural" },
  "ga": { f: "ga-IE-OrlaNeural", m: "ga-IE-ColmNeural" },
  "hr": { f: "hr-HR-GabrijelaNeural", m: "hr-HR-SreckoNeural" },
  "hu": { f: "hu-HU-NoemiNeural", m: "hu-HU-TamasNeural" },
  "id": { f: "id-ID-GadisNeural", m: "id-ID-ArdiNeural" },
  "is": { f: "is-IS-GudrunNeural", m: "is-IS-GunnarNeural" },
  "it": { f: "it-IT-ElsaNeural", m: "it-IT-GiuseppeMultilingualNeural" },
  "ja": { f: "ja-JP-NanamiNeural", m: "ja-JP-KeitaNeural" },
  "km": { f: "km-KH-SreymomNeural", m: "km-KH-PisethNeural" },
  "ko": { f: "ko-KR-SunHiNeural", m: "ko-KR-HyunsuMultilingualNeural" },
  "lt": { f: "lt-LT-OnaNeural", m: "lt-LT-LeonasNeural" },
  "lv": { f: "lv-LV-EveritaNeural", m: "lv-LV-NilsNeural" },
  "mn": { f: "mn-MN-YesuiNeural", m: "mn-MN-BataaNeural" },
  "ms": { f: "ms-MY-YasminNeural", m: "ms-MY-OsmanNeural" },
  "mt": { f: "mt-MT-GraceNeural", m: "mt-MT-JosephNeural" },
  "nb": { f: "nb-NO-PernilleNeural", m: "nb-NO-FinnNeural" },
  "ne": { f: "ne-NP-HemkalaNeural", m: "ne-NP-SagarNeural" },
  "nl": { f: "nl-NL-ColetteNeural", m: "nl-NL-MaartenNeural" },
  "pl": { f: "pl-PL-ZofiaNeural", m: "pl-PL-MarekNeural" },
  "pt-BR": { f: "pt-BR-ThalitaMultilingualNeural", m: "pt-BR-AntonioNeural" },
  "pt-PT": { f: "pt-PT-RaquelNeural", m: "pt-PT-DuarteNeural" },
  "ro": { f: "ro-RO-AlinaNeural", m: "ro-RO-EmilNeural" },
  "si": { f: "si-LK-ThiliniNeural", m: "si-LK-SameeraNeural" },
  "sk": { f: "sk-SK-ViktoriaNeural", m: "sk-SK-LukasNeural" },
  "sl": { f: "sl-SI-PetraNeural", m: "sl-SI-RokNeural" },
  "sq": { f: "sq-AL-AnilaNeural", m: "sq-AL-IlirNeural" },
  "sr": { f: "sr-RS-SophieNeural", m: "sr-RS-NicholasNeural" },
  "sv": { f: "sv-SE-SofieNeural", m: "sv-SE-MattiasNeural" },
  "th": { f: "th-TH-PremwadeeNeural", m: "th-TH-NiwatNeural" },
  "tr": { f: "tr-TR-EmelNeural", m: "tr-TR-AhmetNeural" },
  "vi": { f: "vi-VN-HoaiMyNeural", m: "vi-VN-NamMinhNeural" },
  "zh-TW": { f: "zh-TW-HsiaoChenNeural", m: "zh-TW-YunJheNeural" },
};

/**
 * Voz de reserva.
 *
 * Es la que sonaba en TODA la plataforma antes de esto: las ocho llamadas
 * usaban el valor por defecto y nadie pasaba idioma, así que un japonés oía su
 * supercomentario con acento mexicano. Se mantiene como último recurso, no como
 * comportamiento normal.
 */
export const VOZ_RESERVA = "es-MX-DaliaNeural";

/**
 * Devuelve la voz que corresponde a un locale.
 *
 * Acepta tanto los códigos de Vibra ("pt-BR") como uno suelto ("pt"), y cae al
 * idioma cuando el país no coincide: a quien lee en portugués le sirve una voz
 * portuguesa aunque el país no sea el suyo.
 */
export function vozParaLocale(
  locale: string | null | undefined,
  genero: "f" | "m" = "f",
): string {
  if (!locale) return VOZ_RESERVA;

  const exacta = VOCES_POR_LOCALE[locale];
  if (exacta) return exacta[genero];

  const idioma = locale.split("-")[0];
  const porIdioma = VOCES_POR_LOCALE[idioma];
  if (porIdioma) return porIdioma[genero];

  // Un locale con país que no tenemos ("es-AR"): vale cualquiera del idioma.
  const hermano = Object.keys(VOCES_POR_LOCALE).find((k) => k.split("-")[0] === idioma);
  if (hermano) return VOCES_POR_LOCALE[hermano][genero];

  return VOZ_RESERVA;
}

/** Todas las voces que el endpoint debe aceptar. Se deriva del mapa: no puede desfasarse. */
export const VOCES_PERMITIDAS: ReadonlySet<string> = new Set([
  ...Object.values(VOCES_POR_LOCALE).flatMap((v) => [v.f, v.m]),
  VOZ_RESERVA,
]);
