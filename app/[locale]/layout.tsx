import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages } from "next-intl/server";
import { routing } from "@/i18n/routing";
import GlobalSessionCard from "@/app/components/SessionCountdownBanner/GlobalSessionCard";
import GlobalSessionScheduleOverlay from "@/app/components/SessionCountdownBanner/GlobalSessionScheduleOverlay";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
      <GlobalSessionCard />
      <GlobalSessionScheduleOverlay />
    </NextIntlClientProvider>
  );
}
