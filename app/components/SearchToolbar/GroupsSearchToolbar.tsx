"use client";

import { useRef, useState } from "react";

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
  placeholder = "Buscar comunidades, perfiles o publicaciones...",
  ariaLabel = "Buscar comunidades, perfiles o publicaciones",
}: GroupsSearchToolbarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const fieldBorder = "1px solid rgba(255,255,255,0.18)";
  const fieldBg = "rgba(255,255,255,0.045)";
  const fieldBgFocus = "rgba(255,255,255,0.065)";
  const hasSearch = search.trim().length > 0;
  const isExpanded = isFocused || hasSearch || showCloseSearch;

  function focusInput() {
    inputRef.current?.focus();
  }

  function blurInput() {
    inputRef.current?.blur();
  }

  function handleClearSearch() {
    onSearchChange("");
    blurInput();
  }

  function handleClose() {
    onSearchChange("");
    blurInput();
    onCloseSearch?.();
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

        .search-main {
          min-width: 0;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .mobile-search-emoji-btn {
          display: none;
        }

        .search-input-wrap {
          position: relative;
          min-width: 0;
          width: ${isExpanded ? "min(100%, 920px)" : "360px"};
          max-width: 920px;
          transition:
            width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
            max-width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: center;
        }

        .search-input-wrap:focus-within {
          transform: translateY(-1px);
        }

        .search-input {
          width: 100%;
          height: 46px;
          padding: 0 42px 0 16px;
          border-radius: 14px;
          border: ${fieldBorder};
          background: ${fieldBg};
          color: #fff;
          outline: none;
          font-size: 14px;
          box-sizing: border-box;
          transition:
            border-color 0.18s ease,
            background 0.18s ease,
            box-shadow 0.18s ease;
          appearance: none;
          -webkit-appearance: none;
          font-family: ${fontStack};
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
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
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
            grid-template-columns: minmax(0, 1fr) ${showCreateGroup ? "auto" : ""};
          }

          .search-main {
            justify-content: center;
            gap: ${isExpanded ? "0px" : "0px"};
          }

          .mobile-search-emoji-btn {
            width: ${isExpanded ? "0px" : "46px"};
            min-width: ${isExpanded ? "0px" : "46px"};
            height: 46px;
            padding: 0;
            border-radius: 14px;
            border: ${fieldBorder};
            background: ${fieldBg};
            color: #fff;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            line-height: 1;
            overflow: hidden;
            opacity: ${isExpanded ? "0" : "1"};
            transform: ${isExpanded ? "scale(0.92)" : "scale(1)"};
            transition:
              width 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              min-width 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.18s ease,
              transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              background 0.18s ease;
            flex-shrink: 0;
          }

          .mobile-search-emoji-btn:hover {
            background: rgba(255, 255, 255, 0.06);
          }

          .mobile-search-emoji-btn:focus-visible {
            outline: 2px solid rgba(255, 255, 255, 0.28);
            outline-offset: 2px;
          }

          .search-input-wrap {
            width: ${isExpanded ? "min(100%, 360px)" : "0px"};
            max-width: calc(100vw - 32px);
            overflow: hidden;
            opacity: ${isExpanded ? "1" : "0"};
            transform: ${isExpanded ? "translateY(-1px) scale(1)" : "scale(0.96)"};
            transition:
              width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.18s ease,
              transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
          }

          .search-input {
            height: 46px;
            padding-left: 14px;
          }
        }
      `}</style>

      <div className="search-toolbar">
        <div className="search-main">
          <button
            type="button"
            className="mobile-search-emoji-btn"
            onClick={focusInput}
            aria-label={ariaLabel}
            title={ariaLabel}
          >
            <span aria-hidden="true">🔍</span>
          </button>

          <div className="search-input-wrap">
            <input
              ref={inputRef}
              type="text"
              placeholder={placeholder}
              value={search}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleClose();
                }
              }}
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
                onClick={handleClose}
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