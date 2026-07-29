"use client";

import { useTranslations } from "next-intl";
import VibraSavedPostIcon from "@/app/components/VibraServiceIcons/VibraSavedPostIcon";

type PostSaveButtonProps = {
  count?: number;
  saved?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
};

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }

  return String(value);
}

export default function PostSaveButton({
  count = 0,
  saved = false,
  disabled = false,
  loading = false,
  onClick,
  className = "",
}: PostSaveButtonProps) {
  const tPosts = useTranslations("posts");
  const safeCount = Math.max(0, Number.isFinite(count) ? count : 0);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-pressed={saved}
      aria-label={saved ? tPosts("unsave") : tPosts("save")}
      title={saved ? tPosts("unsave") : tPosts("save")}
      className={[
        "inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-semibold transition",
        "focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className="inline-flex leading-none">
        <VibraSavedPostIcon saved={saved} size={20} color="#a855f7" />
      </span>

      <span className="min-w-[1ch] tabular-nums text-neutral-400">
        {formatCount(safeCount)}
      </span>
    </button>
  );
}