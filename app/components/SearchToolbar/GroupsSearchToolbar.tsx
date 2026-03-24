"use client";

export type GroupsSearchToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onCreateGroup?: () => void;
  onCloseSearch?: () => void;
  fontStack: string;
  showCreateGroup?: boolean;
  showCloseSearch?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

export default function GroupsSearchToolbar({
  search,
  onSearchChange,
  onCreateGroup,
  onCloseSearch,
  fontStack,
  showCreateGroup = true,
  showCloseSearch = false,
  placeholder = "Buscar comunidad o perfil por nombre...",
  ariaLabel = "Buscar comunidad o perfil por nombre",
}: GroupsSearchToolbarProps) {
  const fieldBorder = "1px solid rgba(255,255,255,0.18)";
  const fieldBg = "rgba(255,255,255,0.045)";
  const fieldBgFocus = "rgba(255,255,255,0.065)";
  const hasSearch = search.trim().length > 0;

  function handleClearSearch() {
    onSearchChange("");
  }

  return (
    <>
      <style jsx>{`
        .search-toolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) ${showCreateGroup ? "auto" : ""};
          gap: 8px;
          align-items: center;
          width: 100%;
        }

        .search-input-wrap {
          position: relative;
          min-width: 0;
          width: 100%;
        }

        .search-input {
          width: 100%;
          height: 46px;
          padding: 0 42px 0 14px;
          border-radius: 14px;
          border: ${fieldBorder};
          background: ${fieldBg};
          color: #fff;
          outline: none;
          font-size: 14px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, background 0.18s ease;
          appearance: none;
          -webkit-appearance: none;
        }

        .search-input::placeholder {
          color: rgba(255, 255, 255, 0.46);
        }

        .search-input::-webkit-search-cancel-button,
        .search-input::-webkit-search-decoration,
        .search-input::-ms-clear,
        .search-input::-ms-reveal {
          display: none;
          appearance: none;
          -webkit-appearance: none;
        }

        .search-input:focus {
          border-color: rgba(255, 255, 255, 0.28);
          background: ${fieldBgFocus};
        }

        .inner-action-btn {
          position: absolute;
          top: 50%;
          right: 10px;
          transform: translateY(-50%);
          width: 24px;
          height: 24px;
          padding: 0;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 999px;
        }

        .inner-action-btn:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        .inner-action-btn:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.28);
          outline-offset: 2px;
        }

        .create-btn {
          width: 46px;
          min-width: 46px;
          height: 46px;
          padding: 0;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: #fff;
          color: #000;
          cursor: pointer;
          font-weight: 600;
          font-size: 20px;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
          flex-shrink: 0;
          line-height: 1;
        }

        .create-btn:hover {
          transform: translateY(-1px);
        }

        .create-btn:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.28);
          outline-offset: 2px;
        }

        @media (max-width: 640px) {
          .search-toolbar {
            gap: 8px;
          }
        }
      `}</style>

      <div className="search-toolbar">
        <div className="search-input-wrap">
          <input
            type="text"
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
            aria-label={ariaLabel}
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />

          {showCloseSearch && onCloseSearch ? (
            <button
              type="button"
              className="inner-action-btn"
              onClick={onCloseSearch}
              aria-label="Cerrar búsqueda"
              title="Cerrar búsqueda"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6 6L18 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : hasSearch ? (
            <button
              type="button"
              className="inner-action-btn"
              onClick={handleClearSearch}
              aria-label="Limpiar búsqueda"
              title="Limpiar búsqueda"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6 6L18 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null}
        </div>

        {showCreateGroup && onCreateGroup && (
          <button
            onClick={onCreateGroup}
            className="create-btn"
            aria-label="Crear comunidad"
            title="Crear comunidad"
            type="button"
          >
            +
          </button>
        )}
      </div>
    </>
  );
}