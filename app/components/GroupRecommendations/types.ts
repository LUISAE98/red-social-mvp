import type { CanonicalGroupCategory, Currency } from "@/types/group";

export type RecommendationReason =
  | "onboarding_categories"
  | "joined_groups_affinity"
  | "mixed_affinity"
  | "fallback_popular";

export type RecommendationGroupCard = {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  visibility: "public" | "private" | "hidden";
  category: CanonicalGroupCategory | null;
  tags: string[];
  memberCount?: number | null;
  monetization?: {
    isPaid?: boolean;
    subscriptionsEnabled?: boolean;
    priceMonthly?: number | null;
    currency?: Currency | null;
    subscriptionPriceMonthly?: number | null;
    subscriptionCurrency?: Currency | null;
  } | null;
};

export type StoredRecommendationPreferences = {
  selectedCategories: CanonicalGroupCategory[];
  joinedCategories: CanonicalGroupCategory[];
  joinedTags: string[];
  onboardingCompleted: boolean;
  updatedAt: number;
};

export type RecommendationFetchResult = {
  groups: RecommendationGroupCard[];
  reason: RecommendationReason;
  selectedCategories: CanonicalGroupCategory[];
  onboardingCompleted: boolean;
};

export type RecommendationRailContext = "home" | "profile" | "group" | "search_empty";

export type RecommendationJoinState = "join" | "request" | "joined" | "pending";