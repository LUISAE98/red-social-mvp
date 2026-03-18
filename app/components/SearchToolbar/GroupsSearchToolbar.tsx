"use client";

type GroupsSearchToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onCreateGroup: () => void;
  fontStack: string;
};

export default function GroupsSearchToolbar({
  search,
  onSearchChange,
  onCreateGroup,
  fontStack,
}: GroupsSearchToolbarProps) {
  const fieldBorder = "1px solid rgba(255,255,255,0.18)";
  const fieldBg = "rgba(255,255,255,0.045)";
  const fieldBgFocus = "rgba(255,255,255,0.065)";

  return (
    <>
      <style jsx>{`
        .search-toolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .search-input {
          width: 100%;
          height: 46px;
          padding: 0 14px;
          border-radius: 14px;
          border: ${fieldBorder};
          background: ${fieldBg};
          color: #fff;
          outline: none;
          font-size: 14px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, background 0.18s ease;
        }

        .search-input:focus {
          border-color: rgba(255, 255, 255, 0.28);
          background: ${fieldBgFocus};
        }

        .create-btn {
          height: 46px;
          padding: 0 16px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: #fff;
          color: #000;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .create-btn-mobile-text {
          display: none;
        }

        @media (max-width: 640px) {
          .search-toolbar {
            grid-template-columns: minmax(0, 1fr) 46px;
            gap: 8px;
          }

          .create-btn {
            width: 46px;
            min-width: 46px;
            padding: 0;
            border-radius: 14px;
            font-size: 20px;
            line-height: 1;
          }

          .create-btn-desktop-text {
            display: none;
          }

          .create-btn-mobile-text {
            display: inline;
          }
        }
      `}</style>

      <div className="search-toolbar">
        <input
          placeholder="Buscar grupo o perfil por nombre..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="search-input"
        />

        <button
          onClick={onCreateGroup}
          className="create-btn"
          aria-label="Crear grupo"
          title="Crear grupo"
          type="button"
        >
          <span className="create-btn-mobile-text">+</span>
          <span className="create-btn-desktop-text">+ Crear grupo</span>
        </button>
      </div>
    </>
  );
}