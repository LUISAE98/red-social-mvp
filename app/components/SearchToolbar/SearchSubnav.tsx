"use client";

type TabType = "groups" | "profiles" | "posts";

type SearchSubnavProps = {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
};

export default function SearchSubnav({
  activeTab,
  onChangeTab,
}: SearchSubnavProps) {
  const tabs: Array<{
    key: TabType;
    label: string;
    emoji: string;
  }> = [
    { key: "groups", label: "Comunidades", emoji: "🌍" },
    { key: "profiles", label: "Perfiles", emoji: "🧍" },
    { key: "posts", label: "Publicaciones", emoji: "📰" },
  ];

  return (
    <nav className="search-subnav" aria-label="Secciones de búsqueda">
      {tabs.map((tab) => {
        const active = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            type="button"
            className={`search-subnav-item ${active ? "active" : ""}`}
            onClick={() => onChangeTab(tab.key)}
          >
            <span className="search-subnav-emoji" aria-hidden="true">
              {tab.emoji}
            </span>
            <span className="search-subnav-label">{tab.label}</span>
          </button>
        );
      })}

      <style jsx>{`
        .search-subnav {
          width: min(100%, 1040px);
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0;
          margin: 0 auto 18px;
          padding: 0 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          box-sizing: border-box;
        }

        .search-subnav-item {
          position: relative;
          min-height: 56px;
          border: 0;
          background: transparent;
          color: rgba(255, 255, 255, 0.62);
          cursor: pointer;
display: inline-flex;
flex-direction: column;
align-items: center;
justify-content: center;
gap: 4px;
padding: 0 10px 3px;
          font-size: 12px;
          font-weight: 700;
          font-family: inherit;
          line-height: 1.1;
        }

        .search-subnav-item.active {
          color: #fff;
        }

        .search-subnav-item.active::after {
          content: "";
          position: absolute;
          left: 50%;
          bottom: 0;
          width: min(108px, 58%);
          height: 2px;
          border-radius: 999px;
          background: #fff;
          transform: translateX(-50%);
        }

        .search-subnav-emoji {
          font-size: 20px;
          line-height: 1;
          display: inline-flex;
        }

        .search-subnav-label {
          min-width: 0;
          white-space: nowrap;
        }

        @media (max-width: 768px) {
          .search-subnav {
            width: 100%;
            margin-bottom: 14px;
            padding: 0 6px;
          }

          .search-subnav-item {
            min-height: 52px;
            gap: 3px;
            font-size: 13px;
            padding-left: 4px;
            padding-right: 4px;
          }

          .search-subnav-emoji {
            font-size: 16px;
          }

          .search-subnav-item.active::after {
            width: min(78px, 64%);
            height: 2px;
          }
        }

        @media (max-width: 420px) {
          .search-subnav-item {
            font-size: 12px;
            gap: 5px;
          }

          .search-subnav-emoji {
            font-size: 15px;
          }
        }
      `}</style>
    </nav>
  );
}