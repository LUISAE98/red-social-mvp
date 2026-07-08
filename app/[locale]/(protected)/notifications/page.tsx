import { useTranslations } from "next-intl";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        color: "rgba(255,255,255,0.4)",
        fontSize: "15px",
        fontWeight: 500,
        textAlign: "center",
        padding: "24px",
      }}
    >
      {t("placeholder")}
    </div>
  );
}
