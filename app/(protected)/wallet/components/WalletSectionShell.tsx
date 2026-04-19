"use client";

import WalletSubnav, { type WalletTabKey } from "./WalletSubNav";

export default function WalletSectionShell({
  activeTab,
  children,
}: {
  activeTab: WalletTabKey;
  children: React.ReactNode;
}) {
  return (
    <>
      <style jsx>{`
        .page {
          width: 100%;
          color: #ffffff;
          font-family:
            -apple-system,
            BlinkMacSystemFont,
            "SF Pro Text",
            "SF Pro Display",
            system-ui,
            sans-serif;
        }

        .header {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 28px;
        }

        .title {
          margin: 0;
          font-size: 44px;
          line-height: 0.98;
          letter-spacing: -0.04em;
          font-weight: 700;
          color: #ffffff;
        }

        .subnavWrap {
          width: 100%;
        }

        .content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        @media (max-width: 900px) {
          .page {
            padding-left: 12px;
            padding-right: 12px;
            box-sizing: border-box;
          }

          .header {
            gap: 12px;
            margin-bottom: 22px;
          }

          .title {
            font-size: 34px;
          }
        }
      `}</style>

      <div className="page">
        <div className="header">
          <h1 className="title">Wallet</h1>

          <div className="subnavWrap">
            <WalletSubnav activeTab={activeTab} />
          </div>
        </div>

        <section className="content">{children}</section>
      </div>
    </>
  );
}