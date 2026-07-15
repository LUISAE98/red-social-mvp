"use client";

import {
  GROUP_CATEGORY_OPTIONS,
  type CanonicalGroupCategory,
} from "@/types/group";

type CategoryPillSelectorProps = {
  selected: CanonicalGroupCategory[];
  onToggle: (value: CanonicalGroupCategory) => void;
  disabled?: boolean;
};

/**
 * Selector reutilizable de categorías (pills) sobre GROUP_CATEGORY_OPTIONS.
 * Se usa tanto en el onboarding de categorías como en el panel de intereses
 * de la configuración de perfil.
 */
export default function CategoryPillSelector({
  selected,
  onToggle,
  disabled = false,
}: CategoryPillSelectorProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        width: "100%",
      }}
    >
      {GROUP_CATEGORY_OPTIONS.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(option.value)}
            style={{
              border: isSelected
                ? "1px solid rgba(255,255,255,0.9)"
                : "1px solid rgba(255,255,255,0.10)",
              background: isSelected ? "#ffffff" : "rgba(42, 42, 46, 0.95)",
              color: isSelected ? "#08111d" : "#ffffff",
              borderRadius: 999,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
              whiteSpace: "nowrap",
              fontFamily: "inherit",
              transition: "background 150ms ease, color 150ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
