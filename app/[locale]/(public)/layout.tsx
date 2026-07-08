"use client";

import LanguageSwitcher from "@/app/components/LanguageSwitcher";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`.vb-pub-lang-wrap{display:flex;position:fixed;top:14px;right:16px;z-index:200}@media(max-width:900px){.vb-pub-lang-wrap{display:none}}`}</style>
      <div className="vb-pub-lang-wrap">
        <LanguageSwitcher variant="desktop" />
      </div>
      <LanguageSwitcher variant="mobile-bubble" />
      {children}
    </>
  );
}
