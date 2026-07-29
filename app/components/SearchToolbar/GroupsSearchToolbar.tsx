"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type GroupsSearchToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onCreateGroup?: () => void;
  onCloseSearch?: () => void;
  onFocusChange?: (focused: boolean) => void;
  onEnterKey?: () => void;
  fontStack: string;
  showCreateGroup?: boolean;
  showCloseSearch?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  isMobileClosing?: boolean;
  autoFocusOnMount?: boolean;
};

export default function GroupsSearchToolbar({
  search,
  onSearchChange,
  onCreateGroup,
  onCloseSearch,
  onFocusChange,
  onEnterKey,
  fontStack,
  showCreateGroup = true,
  showCloseSearch = false,
  placeholder,
  ariaLabel,
  isMobileClosing = false,
  autoFocusOnMount = false,
}: GroupsSearchToolbarProps) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const resolvedPlaceholder = placeholder ?? tCommon("searchPlaceholder");
  const resolvedAriaLabel = ariaLabel ?? tCommon("searchAriaLabel");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const hasSearch = search.trim().length > 0;
  const isExpanded = isFocused || hasSearch || showCloseSearch;

  useEffect(() => {
    if (!autoFocusOnMount) return;

    const input = inputRef.current;
    if (!input) return;

    const focusInput = () => {
      input.focus({ preventScroll: true });

      // Refuerzo para móviles: ayuda a que iOS/Android abran el teclado
      // después de que el input ya existe y la barra terminó de montarse.
      input.click();
    };

    focusInput();

    const animationFrameId = window.requestAnimationFrame(() => {
      focusInput();
    });

    const timeoutId = window.setTimeout(() => {
      focusInput();
    }, 120);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [autoFocusOnMount]);

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

.search-input-wrap {
  position: relative;
  min-width: 0;
  width: ${isExpanded ? "min(100%, 600px)" : "360px"};
  max-width: 600px;
  padding: 2px;
  border-radius: 20px;
  background: linear-gradient(
    100deg,
    #ff2fb3 0%,
    #a855f7 45%,
    #4f46ff 100%
  );
  background-size: 220% 220%;
  animation: vibraSearchBorderFlow 4.2s ease-in-out infinite;
  transition:
    width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.search-input-wrap:focus-within {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
}

.search-input {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 40px;
  padding: 0 42px 0 15px;
  border-radius: 18px;
  border: none;
  background: rgba(8, 5, 24, 0.94);
  color: #fff;
  color-scheme: dark;
  outline: none;
  font-size: 13px;
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  font-family: ${fontStack};
  backdrop-filter: blur(14px) saturate(120%);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.search-input:focus {
  background: rgba(10, 6, 28, 0.96);
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

        .inner-action-btn {
          position: absolute;
          z-index: 20;
          top: 50%;
          right: 11px;
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

        .create-btn {
          width: 46px;
          min-width: 46px;
          height: 46px;
          padding: 0;
          border-radius: 10px;
          border: none;
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 52%, #4f46ff 100%);
          color: #fff;
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
          box-shadow: 0 10px 28px rgba(168, 85, 255, 0.22);
        }

        .create-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
        }

        @keyframes vibraSearchBorderFlow {
          0%,
          100% {
            background-position: 0% 50%;
          }

          50% {
            background-position: 100% 50%;
          }
        }

        @media (max-width: 640px) {
          .search-main {
            justify-content: center;
          }

.search-input-wrap {
  width: 100%;
  max-width: 100%;
  opacity: 1;
  transform: none;
  overflow: hidden;
  transform-origin: right center;
  animation:
    mobileToolbarOpen 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards,
    vibraSearchBorderFlow 4.2s ease-in-out infinite;
}

.search-input-wrap.mobile-closing {
  animation:
    mobileToolbarClose 0.26s ease forwards,
    vibraSearchBorderFlow 4.2s ease-in-out infinite;
}

@keyframes mobileToolbarOpen {
  from {
    clip-path: inset(0 0 0 100% round 18px);
  }

  to {
    clip-path: inset(0 0 0 0 round 18px);
  }
}

@keyframes mobileToolbarClose {
  from {
    clip-path: inset(0 0 0 0 round 18px);
  }

  to {
    clip-path: inset(0 0 0 100% round 18px);
  }
}

.search-input {
  height: 40px;
  padding-left: 14px;
  font-size: 13px;
}
        }

        @media (prefers-reduced-motion: reduce) {
          .search-input-wrap {
            animation: none;
          }
        }
      `}</style>

      <div className="search-toolbar">
        <div className="search-main">
          <div className={`search-input-wrap${isMobileClosing ? " mobile-closing" : ""}`}>
            <input
              ref={inputRef}
              type="text"
              placeholder={resolvedPlaceholder}
              value={search}
              onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
              onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleClose();
                } else if (e.key === "Enter") {
                  onEnterKey?.();
                }
              }}
              className="search-input"
              aria-label={resolvedAriaLabel}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            {showCloseSearch && onCloseSearch ? (
              <button
                type="button"
                className="inner-action-btn"
                onClick={handleClose}
                aria-label={tCommon("closeSearchAriaLabel")}
                title={tCommon("closeSearchAriaLabel")}
              >
                ✕
              </button>
            ) : hasSearch ? (
              <button
                type="button"
                className="inner-action-btn"
                onClick={handleClearSearch}
                aria-label={tCommon("clearSearch")}
                title={tCommon("clearSearch")}
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>

        {showCreateGroup && onCreateGroup && (
          <button
            onClick={onCreateGroup}
            className="create-btn"
            aria-label={tGroups("createCommunity")}
            title={tGroups("createCommunity")}
            type="button"
          >
            +
          </button>
        )}
      </div>
    </>
  );
}