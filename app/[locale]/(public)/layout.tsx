import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`.vb-pub-lang-wrap{display:flex;gap:4px;position:fixed;top:14px;right:16px;z-index:200}@media(max-width:900px){.vb-pub-lang-wrap{display:none}}`}</style>
      <div className="vb-pub-lang-wrap">
        <CurrencySwitcher variant="desktop" />
        <LanguageSwitcher variant="desktop" />
      </div>
      <CurrencySwitcher variant="mobile-bubble" />
      <LanguageSwitcher variant="mobile-bubble" />
      {children}
    </>
  );
}
