"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { searchStories } from "@/lib/stories/searchStories";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import StoryViewer from "@/app/components/Stories/StoryViewer";

const MIN_STORY_SEARCH_LENGTH = 2;
const STORY_SEARCH_PAGE_SIZE = 40;

type Filter = "all" | StoryType;

type SearchStoriesResultsProps = {
  search: string;
};

function storyThumbnail(story: StoryDoc): string | null {
  if (story.thumbnailUrl) return story.thumbnailUrl;
  if (story.muxPlaybackId) {
    return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  }
  return null;
}

export default function SearchStoriesResults({ search }: SearchStoriesResultsProps) {
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");

  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const normalizedSearch = useMemo(() => search.trim(), [search]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (normalizedSearch.length < MIN_STORY_SEARCH_LENGTH) {
        setStories([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const result = await searchStories({
        search: normalizedSearch,
        pageSize: STORY_SEARCH_PAGE_SIZE,
      });
      if (!active) return;
      setStories(result);
      setLoading(false);
    }

    run();
    return () => {
      active = false;
    };
  }, [normalizedSearch]);

  const filtered = useMemo(
    () => (filter === "all" ? stories : stories.filter((s) => s.type === filter)),
    [stories, filter]
  );

  const filters: Array<{ key: Filter; label: string; emoji: string }> = [
    { key: "all", label: tNav("searchStoriesAll"), emoji: "🎬" },
    { key: "saludo", label: tNav("searchStoriesGreetings"), emoji: "👋" },
    { key: "consejo", label: tNav("searchStoriesAdvice"), emoji: "💡" },
  ];

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    margin: "-16px auto 18px",
    display: "grid",
    gap: 14,
  };

  const filtersRowStyle: CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
  };

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
    gap: 10,
  };

  if (normalizedSearch.length < MIN_STORY_SEARCH_LENGTH) {
    return (
      <section style={shellStyle}>
        <div style={emptyStyle}>{tCommon("writeToSearch")}</div>
      </section>
    );
  }

  if (loading) {
    return (
      <section style={shellStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "30vh",
          }}
        >
          <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      <div style={filtersRowStyle}>
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minHeight: 34,
                padding: "6px 13px",
                borderRadius: 999,
                border: active ? "none" : "1px solid rgba(255,255,255,0.14)",
                background: active
                  ? "linear-gradient(135deg, #4f46ff, #a855ff)"
                  : "rgba(255,255,255,0.04)",
                color: active ? "#fff" : "rgba(255,255,255,0.72)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              <span aria-hidden="true">{f.emoji}</span>
              {f.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={emptyStyle}>{tCommon("noExactMatches")}</div>
      ) : (
        <div style={gridStyle}>
          {filtered.map((story, index) => {
            const thumb = storyThumbnail(story);
            return (
              <button
                key={story.id}
                type="button"
                onClick={() => setViewerIndex(index)}
                style={{
                  position: "relative",
                  aspectRatio: "9 / 16",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                  background: thumb
                    ? `center / cover no-repeat url(${thumb})`
                    : "linear-gradient(160deg, #2a1a4a, #10101a)",
                  fontFamily: "inherit",
                }}
              >
                {/* Badge de tipo */}
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    left: 6,
                    fontSize: 14,
                    lineHeight: 1,
                    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))",
                  }}
                  aria-hidden="true"
                >
                  {story.type === "consejo" ? "💡" : "👋"}
                </span>

                {/* Nombre del creador */}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "16px 8px 7px",
                    background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
                    color: "#fff",
                    fontSize: 11.5,
                    fontWeight: 600,
                    textAlign: "left",
                    lineHeight: 1.2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {story.creatorName || ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {viewerIndex !== null && filtered[viewerIndex] ? (
        <StoryViewer
          stories={filtered}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </section>
  );
}
