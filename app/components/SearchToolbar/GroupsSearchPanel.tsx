"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
collection,
doc,
onSnapshot,
query,
where,
type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import GroupsSearchToolbar from "./GroupsSearchToolbar";
import { SearchResultsExplorerPanel } from "./SearchResultsExplorerPanel";
import type { CanonicalGroupCategory } from "@/types/group";
import {
  GROUP_CATEGORY_LABELS,
  normalizeGroupCategory,
  normalizeGroupTags,
} from "@/types/group";

export type CommunitySearchMatchType = "exact" | "related" | "suggested";

export type Community = {
  id: string;
  name?: string;
  description?: string;
  avatarUrl?: string | null;
  visibility?: "public" | "private" | "hidden" | string;
  ownerId?: string;
  category?: string;
  tags?: string[];
  discoverable?: boolean;
  isActive?: boolean;
  offerings?: Array<Record<string, any>> | Record<string, any>;
donation?: Record<string, any>;
greetingsEnabled?: boolean;
adviceEnabled?: boolean;
digitalMeetGreetEnabled?: boolean;
customClassEnabled?: boolean;
monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | null;
    greetingsEnabled?: boolean;
adviceEnabled?: boolean;
digitalMeetGreetEnabled?: boolean;
customClassEnabled?: boolean;
  };
  searchMatchType?: CommunitySearchMatchType;
  searchScore?: number;
};

export type PublicUser = {
  uid: string;
  handle: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
  offerings?: Array<Record<string, any>> | Record<string, any>;
  donation?: Record<string, any>;
  monetization?: Record<string, any>;
};

export type CanonicalMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

function normalizeMemberStatus(raw: unknown): CanonicalMemberStatus {
  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";
  return null;
}

export function isJoinedStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "subscribed" || status === "muted";
}

export function isBlockedStatus(status: CanonicalMemberStatus) {
  return status === "banned" || status === "removed";
}

export function membershipStatusLabel(status: CanonicalMemberStatus) {
  if (status === "active") return "Ya estás unido";
  if (status === "subscribed") return "Suscripción activa";
  if (status === "muted") return "Ya estás unido (muteado)";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Expulsado";
  return "";
}

function isPaidGroup(group: Community) {
  return !!group.monetization?.isPaid;
}

function isPaidPrivateGroup(group: Community) {
  return group.visibility === "private" && isPaidGroup(group);
}

export function buildUserSearchText(user: PublicUser) {
  return [
    user.handle,
    user.displayName,
    user.firstName,
    user.lastName,
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function buildCommunitySearchText(group: Community) {
  return [group.name ?? "", group.description ?? "", group.visibility ?? ""]
    .join(" ")
    .toLowerCase();
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const SEARCH_STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "o",
  "a",
  "en",
  "por",
  "para",
  "con",
  "sin",
  "un",
  "una",
  "unos",
  "unas",
]);

function tokenizeSearch(value: string) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/[^a-z0-9]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && !SEARCH_STOP_WORDS.has(item))
    )
  );
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "U";
}

function getDescriptionPreview(value?: string) {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");

  if (!clean) return "";

  if (clean.length <= 60) return clean;

  return `${clean.slice(0, 80).trim()}...`;
}

type SearchServiceDot = {
  key: string;
  color: string;
  title: string;
};

const SEARCH_SERVICE_COLORS = {
  saludo: "#7DD3FC",
  consejo: "#FACC15",
  meetGreet: "#A78BFA",
  exclusiveSession: "#F472B6",
  weddingDonation: "#C084FC",
  generalDonation: "#FB7185",
};

function getOfferingByType(
  offerings: Array<Record<string, any>> | Record<string, any> | undefined,
  type: string
): Record<string, any> | null {
  if (!offerings) return null;

  if (Array.isArray(offerings)) {
    return offerings.find((item) => item?.type === type) ?? null;
  }

  const direct = offerings[type];

  if (typeof direct === "object" && direct !== null) {
    return direct as Record<string, any>;
  }

  if (direct === true) {
    return { enabled: true, visible: true };
  }

  return null;
}

function isVisibleEnabledService(service: Record<string, any> | null): boolean {
  if (!service) return false;

  const enabled = service.enabled === true;
  const visible = service.visible !== false;

  return enabled && visible;
}

function buildSearchServiceDots(source?: {
  offerings?: Array<Record<string, any>> | Record<string, any>;
  donation?: Record<string, any>;
  monetization?: Record<string, any>;
  greetingsEnabled?: boolean;
  adviceEnabled?: boolean;
  digitalMeetGreetEnabled?: boolean;
  customClassEnabled?: boolean;
}): SearchServiceDot[] {
  const offerings = source?.offerings;
  const donation = source?.donation ?? {};
  const monetization = source?.monetization ?? {};

  const dots: SearchServiceDot[] = [];

  const saludoEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "saludo")) ||
    source?.greetingsEnabled === true ||
    monetization.greetingsEnabled === true;

  const consejoEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "consejo")) ||
    source?.adviceEnabled === true ||
    monetization.adviceEnabled === true;

  const meetGreetEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "meet_greet_digital")) ||
    source?.digitalMeetGreetEnabled === true ||
    monetization.digitalMeetGreetEnabled === true;

  const exclusiveSessionEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "clase_personalizada")) ||
    source?.customClassEnabled === true ||
    monetization.customClassEnabled === true;

  if (saludoEnabled) {
    dots.push({
      key: "saludo",
      color: SEARCH_SERVICE_COLORS.saludo,
      title: "Solicitar saludo",
    });
  }

  if (consejoEnabled) {
    dots.push({
      key: "consejo",
      color: SEARCH_SERVICE_COLORS.consejo,
      title: "Solicitar consejo",
    });
  }

  if (meetGreetEnabled) {
    dots.push({
      key: "meet_greet_digital",
      color: SEARCH_SERVICE_COLORS.meetGreet,
      title: "Agendar encuentro",
    });
  }

  if (exclusiveSessionEnabled) {
    dots.push({
      key: "clase_personalizada",
      color: SEARCH_SERVICE_COLORS.exclusiveSession,
      title: "Reservar sesión exclusiva",
    });
  }

  if (
    donation.enabled === true &&
    donation.visible !== false &&
    donation.mode === "wedding"
  ) {
    dots.push({
      key: "wedding_donation",
      color: SEARCH_SERVICE_COLORS.weddingDonation,
      title: "Apoyar boda",
    });
  }

  if (
    donation.enabled === true &&
    donation.visible !== false &&
    donation.mode === "general"
  ) {
    dots.push({
      key: "general_donation",
      color: SEARCH_SERVICE_COLORS.generalDonation,
      title: "Apoyar",
    });
  }

  return dots;
}

function ServiceDots({ dots }: { dots: SearchServiceDot[] }) {
  if (dots.length === 0) return null;

  return (
    <span
      aria-label="Servicios activos"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {dots.map((dot) => (
        <span
          key={dot.key}
          title={dot.title}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            border: "none",
            background: dot.color,
            boxSizing: "border-box",
            display: "inline-flex",
            flexShrink: 0,
          }}
        />
      ))}
    </span>
  );
}

function buildCommunityDiscoveryText(group: Community) {
  const canonicalCategory = normalizeGroupCategory(group.category);
  const categoryLabel = canonicalCategory
    ? GROUP_CATEGORY_LABELS[canonicalCategory]
    : "";

  const tags = normalizeGroupTags(group.tags).join(" ");

  return normalizeText(
    [
      group.name ?? "",
      group.description ?? "",
      group.visibility ?? "",
      canonicalCategory ?? "",
      categoryLabel,
      tags,
    ]
      .join(" ")
      .trim()
  );
}

const CATEGORY_KEYWORDS: Record<CanonicalGroupCategory, string[]> = {
  entretenimiento: [
    "entretenimiento",
    "show",
    "shows",
    "peliculas",
    "series",
    "cine",
    "tv",
    "humor",
  ],
  musica: [
    "musica",
    "music",
    "cantante",
    "banda",
    "musico",
    "concierto",
    "album",
    "canciones",
  ],
  creadores: [
    "creadores",
    "creador",
    "influencer",
    "streamer",
    "youtuber",
    "podcast",
    "podcaster",
    "contenido",
  ],
  gaming: [
    "gaming",
    "gamer",
    "videojuegos",
    "videojuego",
    "esports",
    "xbox",
    "playstation",
    "nintendo",
    "steam",
  ],
  tecnologia: [
    "tecnologia",
    "tech",
    "programacion",
    "codigo",
    "gadgets",
    "ia",
    "ai",
    "web3",
    "crypto",
    "software",
  ],
  deportes: [
    "deportes",
    "deporte",
    "futbol",
    "soccer",
    "liga",
    "box",
    "boxeo",
    "nba",
    "nfl",
    "beisbol",
    "tenis",
  ],
  fitness_bienestar: [
    "fitness",
    "bienestar",
    "salud",
    "running",
    "gym",
    "entrenamiento",
    "wellness",
  ],
  educacion: [
    "educacion",
    "educativo",
    "curso",
    "cursos",
    "clases",
    "aprendizaje",
    "escuela",
  ],
  negocios_finanzas: [
    "negocios",
    "finanzas",
    "empresa",
    "emprendimiento",
    "dinero",
    "inversion",
    "inversiones",
  ],
  noticias_politica: [
    "noticias",
    "politica",
    "actualidad",
    "periodismo",
    "gobierno",
    "elecciones",
  ],
  ciencia: [
    "ciencia",
    "cientifico",
    "cientifica",
    "fisica",
    "quimica",
    "biologia",
  ],
  moda_belleza: [
    "moda",
    "belleza",
    "fashion",
    "makeup",
    "maquillaje",
    "skincare",
  ],
  comida: ["comida", "cocina", "recetas", "food", "chef", "restaurantes"],
  viajes: ["viajes", "viaje", "turismo", "destinos", "aventura"],
  autos: ["autos", "auto", "coches", "carros", "motos", "motor"],
  mascotas: ["mascotas", "mascota", "perros", "gatos", "pet", "pets"],
  hobbies: ["hobbies", "hobbie", "coleccion", "colecciones", "manualidades"],
  familia_comunidad: ["familia", "comunidad", "padres", "madres", "vecinos"],
  instituciones: [
    "instituciones",
    "institucion",
    "empresa",
    "escuela",
    "gobierno",
    "organizacion",
  ],
  otros: ["otros"],
};

function inferCategoriesFromQuery(search: string): CanonicalGroupCategory[] {
  const normalized = normalizeText(search);

  return (Object.entries(CATEGORY_KEYWORDS) as Array<
    [CanonicalGroupCategory, string[]]
  >)
    .filter(([, keywords]) =>
      keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
    )
    .map(([category]) => category);
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

type AffinityContext = {
  queryTokens: string[];
  queryCategories: CanonicalGroupCategory[];
  seedCategories: CanonicalGroupCategory[];
  seedTags: string[];
};

function scoreRelatedCommunity(group: Community, ctx: AffinityContext) {
  const discoveryText = buildCommunityDiscoveryText(group);
  const tags = normalizeGroupTags(group.tags);
  const canonicalCategory = normalizeGroupCategory(group.category);

  const matchedQueryTokens = ctx.queryTokens.filter((token) =>
    discoveryText.includes(token)
  );

  const matchedQueryTags = tags.filter((tag) =>
    ctx.queryTokens.some((token) => tag.includes(token) || token.includes(tag))
  );

  const matchedSeedTags = tags.filter((tag) =>
    ctx.seedTags.some((seed) => tag.includes(seed) || seed.includes(tag))
  );

  let score = 0;

  score += matchedQueryTokens.length * 6;
  score += matchedQueryTags.length * 8;
  score += matchedSeedTags.length * 7;

  if (canonicalCategory && ctx.queryCategories.includes(canonicalCategory)) {
    score += 10;
  }

  if (canonicalCategory && ctx.seedCategories.includes(canonicalCategory)) {
    score += 14;
  }

  return {
    score,
    hasDirectSignal:
      matchedQueryTokens.length > 0 ||
      matchedQueryTags.length > 0 ||
      (canonicalCategory != null &&
        ctx.queryCategories.includes(canonicalCategory)),
    hasAffinitySignal:
      matchedSeedTags.length > 0 ||
      (canonicalCategory != null &&
        ctx.seedCategories.includes(canonicalCategory)),
  };
}

function getCommunityPreviewPriority(
  group: Community,
  currentUser: User | null,
  memberMap: Record<string, CanonicalMemberStatus>,
  reqMap: Record<string, boolean>
) {
  const isOwner =
    !!currentUser && !!group.ownerId && group.ownerId === currentUser.uid;
  const membershipStatus = isOwner ? "active" : memberMap[group.id] ?? null;
  const isMember = isOwner || isJoinedStatus(membershipStatus);
  const isBlocked = !isOwner && isBlockedStatus(membershipStatus);
  const isPrivate = group.visibility === "private";
  const isPublic = group.visibility === "public";
  const hasPendingReq = !!reqMap[group.id];
  const paidPrivate = isPaidPrivateGroup(group);

  if (!isOwner && !isMember && !isBlocked && isPublic) return 0;
  if (!isOwner && !isMember && !isBlocked && paidPrivate) return 1;
  if (!isOwner && !isMember && !isBlocked && isPrivate && !hasPendingReq)
    return 2;
  if (!isOwner && !isMember && !isBlocked && isPrivate && hasPendingReq)
    return 3;
  if (isMember && !isOwner) return 4;
  if (isOwner) return 5;
  if (isBlocked) return 6;
  return 7;
}

type GroupsSearchPanelProps = {
  fontStack: string;
  showCreateGroup?: boolean;
  createGroupHref?: string;
  showCloseSearch?: boolean;
  onCloseSearch?: () => void;
};

export default function GroupsSearchPanel({
  fontStack,
  showCreateGroup = true,
  createGroupHref = "/groups/new",
  showCloseSearch = false,
  onCloseSearch,
}: GroupsSearchPanelProps) {
  const router = useRouter();
  const pathname = usePathname();

  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const previousPathnameRef = useRef<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberMap, setMemberMap] = useState<
    Record<string, CanonicalMemberStatus>
  >({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [fullResultsOpen, setFullResultsOpen] = useState(false);

  const cardBorder = "1px solid rgba(255,255,255,0.14)";
  const softBorder = "1px solid rgba(255,255,255,0.18)";
  const shadow = "0 18px 46px rgba(0,0,0,0.42)";

  const normalizedSearch = search.trim().toLowerCase();
  const hasSearch = normalizedSearch.length > 0;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!hasSearch && !fullResultsOpen) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      if (searchAreaRef.current?.contains(target)) return;

      window.setTimeout(() => {
        setSearch("");
        setFullResultsOpen(false);
        onCloseSearch?.();
      }, 0);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [hasSearch, fullResultsOpen, onCloseSearch]);

useEffect(() => {
  setError(null);
  setCommunitiesLoading(true);

  const col = collection(db, "groups");
  const unsubscribers: Unsubscribe[] = [];
  const groupsById = new Map<string, Community>();

  function syncCommunities() {
    setCommunities(Array.from(groupsById.values()));
    setCommunitiesLoading(false);
  }

  const qPublic = query(col, where("visibility", "==", "public"));

  const unsubPublic = onSnapshot(
    qPublic,
    (snapshot) => {
      snapshot.docs.forEach((d) => {
        groupsById.set(d.id, {
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        });
      });

      syncCommunities();
    },
    (snapshotError) => {
      const message =
        snapshotError instanceof Error
          ? snapshotError.message
          : "Error cargando comunidades";
      setError(message);
      setCommunitiesLoading(false);
    }
  );

  unsubscribers.push(unsubPublic);

  if (user) {
    const qPrivate = query(col, where("visibility", "==", "private"));

    const unsubPrivate = onSnapshot(
      qPrivate,
      (snapshot) => {
        snapshot.docs.forEach((d) => {
          groupsById.set(d.id, {
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          });
        });

        syncCommunities();
      },
      (snapshotError) => {
        const message =
          snapshotError instanceof Error
            ? snapshotError.message
            : "Error cargando comunidades privadas";
        setError(message);
        setCommunitiesLoading(false);
      }
    );

    unsubscribers.push(unsubPrivate);
  }

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}, [user]);

useEffect(() => {
  setProfilesLoading(true);

  const unsubProfiles = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      const rows: PublicUser[] = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;

return {
  uid: typeof data.uid === "string" ? data.uid : d.id,
  handle: typeof data.handle === "string" ? data.handle : "",
  displayName:
    typeof data.displayName === "string" ? data.displayName : "",
  firstName: typeof data.firstName === "string" ? data.firstName : "",
  lastName: typeof data.lastName === "string" ? data.lastName : "",
  photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
  offerings:
    Array.isArray(data.offerings) ||
    (typeof data.offerings === "object" && data.offerings !== null)
      ? (data.offerings as Array<Record<string, any>> | Record<string, any>)
      : undefined,
  donation:
    typeof data.donation === "object" && data.donation !== null
      ? (data.donation as Record<string, any>)
      : undefined,
  monetization:
    typeof data.monetization === "object" && data.monetization !== null
      ? (data.monetization as Record<string, any>)
      : undefined,
};
      });

      setProfiles(rows);
      setProfilesLoading(false);
    },
    (snapshotError) => {
      const message =
        snapshotError instanceof Error
          ? snapshotError.message
          : "Error cargando perfiles";
      setError(message);
      setProfilesLoading(false);
    }
  );

  return () => unsubProfiles();
}, []);

  useEffect(() => {
    if (!user || communities.length === 0) {
      setMemberMap({});
      setReqMap({});
      return;
    }

    const unsubscribers: Unsubscribe[] = [];

    for (const group of communities) {
      const memberRef = doc(db, "groups", group.id, "members", user.uid);
      const requestRef = doc(db, "groups", group.id, "joinRequests", user.uid);

      let latestMembershipStatus: CanonicalMemberStatus = null;
      let latestPendingRequest = false;

      const syncRequestState = () => {
        setMemberMap((prev) => {
          if (prev[group.id] === latestMembershipStatus) return prev;
          return { ...prev, [group.id]: latestMembershipStatus };
        });

        setReqMap((prev) => {
          if (prev[group.id] === latestPendingRequest) return prev;
          return { ...prev, [group.id]: latestPendingRequest };
        });
      };

      const unsubMember = onSnapshot(
        memberRef,
        (snapshot) => {
          latestMembershipStatus = snapshot.exists()
            ? normalizeMemberStatus(
                (snapshot.data() as Record<string, unknown>)?.status ?? "active"
              )
            : null;

          if (
            isJoinedStatus(latestMembershipStatus) ||
            isBlockedStatus(latestMembershipStatus)
          ) {
            latestPendingRequest = false;
          }

          syncRequestState();
        },
        (snapshotError) => {
          const message =
            snapshotError instanceof Error
              ? snapshotError.message
              : "Error leyendo membresía en tiempo real";
          setError(message);
        }
      );

      const unsubRequest = onSnapshot(
        requestRef,
        (snapshot) => {
          const joinRequestData = snapshot.data() as
            | Record<string, unknown>
            | undefined;

          latestPendingRequest =
            !isJoinedStatus(latestMembershipStatus) &&
            !isBlockedStatus(latestMembershipStatus) &&
            snapshot.exists() &&
            (joinRequestData?.status ?? "pending") === "pending";

          syncRequestState();
        },
        (snapshotError) => {
          const message =
            snapshotError instanceof Error
              ? snapshotError.message
              : "Error leyendo solicitud en tiempo real";
          setError(message);
        }
      );

      unsubscribers.push(unsubMember, unsubRequest);
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user, communities]);

  useEffect(() => {
    if (previousPathnameRef.current === null) {
      previousPathnameRef.current = pathname;
      return;
    }

    if (pathname !== previousPathnameRef.current) {
      setSearch("");
      setFullResultsOpen(false);
      onCloseSearch?.();
      previousPathnameRef.current = pathname;
    }
  }, [pathname, onCloseSearch]);

  const searchableCommunities = useMemo(() => {
    return communities.filter((group) => {
      if (group.visibility === "hidden") return false;
      if (group.isActive === false) return false;
      if (group.discoverable === false) return false;
      return true;
    });
  }, [communities]);

  const filteredCommunities = useMemo(() => {
    if (!normalizedSearch) return [];

    const normalizedQuery = normalizeText(search);

    return searchableCommunities.filter((g) => {
      const basicText = normalizeText(buildCommunitySearchText(g));
      const discoveryText = buildCommunityDiscoveryText(g);

      return (
        basicText.includes(normalizedQuery) ||
        discoveryText.includes(normalizedQuery)
      );
    });
  }, [searchableCommunities, normalizedSearch, search]);

  const filteredProfiles = useMemo(() => {
    if (!normalizedSearch) return [];

    const normalizedQuery = normalizeText(search);

    return profiles.filter((p) => {
      if (!p.handle) return false;
      if (user?.uid && p.uid === user.uid) return false;
      return normalizeText(buildUserSearchText(p)).includes(normalizedQuery);
    });
  }, [profiles, normalizedSearch, search, user?.uid]);

  const explorerCommunities = useMemo(() => {
    if (!normalizedSearch) return [];

    const queryTokens = tokenizeSearch(search);
    const queryCategories = inferCategoriesFromQuery(search);

    const exactGroups = searchableCommunities
      .filter((group) => {
        const discoveryText = buildCommunityDiscoveryText(group);
        if (!discoveryText) return false;

        if (discoveryText.includes(normalizeText(search))) {
          return true;
        }

        if (queryTokens.length > 0) {
          return queryTokens.every((token) => discoveryText.includes(token));
        }

        return false;
      })
      .map((group) => ({
        ...group,
        searchMatchType: "exact" as const,
        searchScore: 1000,
      }));

    const exactIds = new Set(exactGroups.map((group) => group.id));

    const seedCategories = uniqueStrings([
      ...exactGroups
        .map((group) => normalizeGroupCategory(group.category))
        .filter((value): value is CanonicalGroupCategory => !!value),
      ...queryCategories,
    ]) as CanonicalGroupCategory[];

    const seedTags = uniqueStrings([
      ...queryTokens,
      ...exactGroups.flatMap((group) => normalizeGroupTags(group.tags)),
    ]);

    const affinityContext: AffinityContext = {
      queryTokens,
      queryCategories,
      seedCategories,
      seedTags,
    };

    const relatedGroups = searchableCommunities
      .filter((group) => !exactIds.has(group.id))
      .map((group) => {
        const scored = scoreRelatedCommunity(group, affinityContext);

        return {
          ...group,
          searchMatchType: "related" as const,
          searchScore: scored.score,
          __hasDirectSignal: scored.hasDirectSignal,
        };
      })
      .filter((group) => group.searchScore > 0 && group.__hasDirectSignal)
      .sort((a, b) => {
        const scoreDiff = (b.searchScore ?? 0) - (a.searchScore ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.name ?? "").localeCompare(b.name ?? "");
      })
      .map(({ __hasDirectSignal, ...group }) => group);

    const relatedIds = new Set(relatedGroups.map((group) => group.id));

    const suggestedGroups = searchableCommunities
      .filter((group) => !exactIds.has(group.id) && !relatedIds.has(group.id))
      .map((group) => {
        const scored = scoreRelatedCommunity(group, affinityContext);

        return {
          ...group,
          searchMatchType: "suggested" as const,
          searchScore: scored.score,
          __hasAffinitySignal: scored.hasAffinitySignal,
        };
      })
      .filter((group) => group.searchScore > 0 && group.__hasAffinitySignal)
      .sort((a, b) => {
        const scoreDiff = (b.searchScore ?? 0) - (a.searchScore ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.name ?? "").localeCompare(b.name ?? "");
      })
      .map(({ __hasAffinitySignal, ...group }) => group);

    return [...exactGroups, ...relatedGroups, ...suggestedGroups];
  }, [normalizedSearch, search, searchableCommunities]);

  const previewCommunities = useMemo(() => {
    const ordered = [...filteredCommunities].sort((a, b) => {
      const priorityA = getCommunityPreviewPriority(a, user, memberMap, reqMap);
      const priorityB = getCommunityPreviewPriority(b, user, memberMap, reqMap);

      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return ordered.slice(0, 4);
  }, [filteredCommunities, user, memberMap, reqMap]);

  const previewProfiles = useMemo(
    () => filteredProfiles.slice(0, 4),
    [filteredProfiles]
  );

  async function handleJoinPublic(groupId: string) {
    if (!user) return;

    try {
      const { joinGroup } = await import("@/lib/groups/membership");
      await joinGroup(groupId, user.uid);

      setMemberMap((prev) => ({
        ...prev,
        [groupId]: "active",
      }));

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo unir a la comunidad";
      setError(message);
    }
  }

  async function handleRequestPrivate(groupId: string) {
    if (!user) return;

    const group = communities.find((item) => item.id === groupId);
    if (group && isPaidPrivateGroup(group)) {
      handleNavigateAndClose(`/groups/${groupId}`);
      return;
    }

    try {
      const { requestToJoin } = await import("@/lib/groups/joinRequests");
      await requestToJoin(groupId, user.uid);

      setReqMap((prev) => ({
        ...prev,
        [groupId]: true,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo enviar solicitud";
      setError(message);
    }
  }

  async function handleCancelRequest(groupId: string) {
    if (!user) return;

    try {
      const { cancelJoinRequest } = await import("@/lib/groups/joinRequests");
      await cancelJoinRequest(groupId, user.uid);

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo cancelar solicitud";
      setError(message);
    }
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user) return;

    if (ownerId && ownerId === user.uid) {
      setError("El owner no puede salir de su propia comunidad.");
      return;
    }

    try {
      const { leaveGroup } = await import("@/lib/groups/membership");
      await leaveGroup(groupId, user.uid);

      setMemberMap((prev) => ({
        ...prev,
        [groupId]: null,
      }));

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo salir de la comunidad";
      setError(message);
    }
  }

  function handleCloseSearch() {
    setSearch("");
    setFullResultsOpen(false);
    onCloseSearch?.();
  }

  function handleNavigateAndClose(href: string) {
    setSearch("");
    setFullResultsOpen(false);
    onCloseSearch?.();
    router.push(href);
  }

  function handleOpenSubscription(groupId: string) {
    handleNavigateAndClose(`/groups/${groupId}`);
  }

  function handleOpenFullResults() {
    if (!normalizedSearch) return;
    setFullResultsOpen(true);
  }

  function handleCloseFullResults() {
    setFullResultsOpen(false);
  }

  const isLoading = authLoading || communitiesLoading || profilesLoading;
  const hasAnyResults =
    filteredCommunities.length > 0 || filteredProfiles.length > 0;

  return (
    <>
      <style jsx>{`
.search-area {
  position: relative;
  z-index: 60;
  width: 100%;
  overflow: visible;
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  width: 100%;
  max-width: 100%;
          border: ${cardBorder};
          border-radius: 20px;
          background: rgba(12, 12, 12, 0.97);
          box-shadow: ${shadow};
          overflow: hidden;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          z-index: 80;
          display: flex;
          flex-direction: column;
          max-height: min(62vh, 560px);
          opacity: 0;
          transform: translateY(-8px) scaleY(0.96);
          transform-origin: top center;
          animation: dropdown-enter 0.28s cubic-bezier(0.22, 1, 0.36, 1)
            forwards;
        }

        @keyframes dropdown-enter {
from {
  opacity: 0;
  transform: translateY(-8px) scaleY(0.96);
}

to {
  opacity: 1;
  transform: translateY(0) scaleY(1);
}
        }

        .search-dropdown-inner {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
        }

        .dropdown-section {
          display: grid;
        }

        .dropdown-section + .dropdown-section {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .dropdown-title {
          margin: 0;
          padding: 12px 14px 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.58);
          background: rgba(255, 255, 255, 0.02);
        }

        .dropdown-helper {
          padding: 14px;
          color: rgba(255, 255, 255, 0.76);
          font-size: 13px;
          line-height: 1.4;
        }

        .dropdown-footer {
          flex: 0 0 auto;
          padding: 10px 12px 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(12, 12, 12, 0.98);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .more-results-btn {
          width: 100%;
          min-height: 40px;
          padding: 9px 12px;
          border-radius: 12px;
          border: ${softBorder};
          background: rgba(255, 255, 255, 0.07);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
          font-family: ${fontStack};
        }

        .more-results-btn:hover {
          background: rgba(255, 255, 255, 0.09);
        }

        .error-card {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          font-size: 13px;
          line-height: 1.45;
        }

        .result-item {
          padding: 10px 14px;
          transition: background 0.16s ease;
          cursor: pointer;
        }

        .result-item:hover {
          background: rgba(255, 255, 255, 0.035);
        }

        .result-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .result-main-mobile {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
        }

        .result-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.04);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .result-avatar-fallback {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
        }

        .result-content {
          min-width: 0;
          display: grid;
          gap: 5px;
        }

.result-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-name-with-meta {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.result-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-name-dot {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.42);
  font-size: 11px;
  line-height: 1;
}

.result-name-visibility {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.visibility-mobile {
  display: none;
}

.service-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.service-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  background: transparent;
  box-sizing: border-box;
  display: inline-flex;
  flex-shrink: 0;
}

.service-dots-desktop {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.service-dots-mobile {
  display: none;
}
  .result-description-preview {
  display: block;
  margin: -1px 0 0;
  max-width: 420px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.25;
  white-space: nowrap;
  text-overflow: ellipsis;
}

        .result-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .pill {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.88);
          line-height: 1.2;
          white-space: nowrap;
        }

        .pill-paid {
          border: 1px solid rgba(255, 225, 166, 0.26);
          background: rgba(255, 225, 166, 0.1);
          font-weight: 600;
        }

        .meta-inline {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.56);
          line-height: 1.25;
        }

        .meta-danger {
          color: rgba(255, 176, 176, 0.9);
        }

        .actions-wrap {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: nowrap;
          flex-shrink: 0;
        }

        .primary-btn {
          min-height: 34px;
          padding: 7px 11px;
          border-radius: 11px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: #fff;
          color: #000;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        .secondary-btn {
          min-height: 34px;
          padding: 7px 11px;
          border-radius: 11px;
          border: ${softBorder};
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: ${fontStack};
          white-space: nowrap;
        }

        .disabled-btn {
          min-height: 34px;
          padding: 7px 11px;
          border-radius: 11px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.68);
          font-weight: 600;
          font-size: 12px;
          font-family: ${fontStack};
          cursor: default;
          white-space: nowrap;
        }

        .profile-cta {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.52);
          white-space: nowrap;
        }

@media (max-width: 640px) {
.service-dot {
  width: 7px;
  height: 7px;
  border-width: 1.4px;
}

.service-dots-desktop {
  display: none;
}

.service-dots-mobile {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 14px;
  margin-top: -1px;
}

.mobile-service-separator {
  color: rgba(255, 255, 255, 0.34);
  font-size: 10px;
  line-height: 1;
  flex-shrink: 0;
}
  .mobile-visibility-label {
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.mobile-visibility-label {
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}
  .search-dropdown {
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    min-width: 100%;
    border-radius: 18px;
    max-height: min(58vh, 460px);
  }

  .result-description-preview {
    display: none;
  }

  .visibility-desktop {
    display: none;
  }

.visibility-mobile {
  display: none;
}

          .dropdown-title {
            padding: 11px 13px 8px;
            font-size: 11px;
          }

          .result-item {
            padding: 10px 12px;
          }

          .result-grid {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: center;
          }

          .result-main-mobile {
            gap: 8px;
            align-items: center;
          }

          .result-avatar {
            width: 38px;
            height: 38px;
          }

          .result-content {
            min-width: 0;
          }

.result-name {
  font-size: 13px;
}

.result-name-visibility {
  font-size: 10px;
}

          .result-meta {
            gap: 5px;
          }

          .actions-wrap {
            justify-content: flex-end;
            width: auto;
          }

          .primary-btn,
          .secondary-btn,
          .disabled-btn {
            min-height: 32px;
            padding: 6px 10px;
            font-size: 11px;
          }

          .profile-cta {
            display: none;
          }
        }
      `}</style>

      <div ref={searchAreaRef} className="search-area">
        <GroupsSearchToolbar
          search={search}
          onSearchChange={setSearch}
          onCreateGroup={
            showCreateGroup ? () => router.push(createGroupHref) : undefined
          }
          onCloseSearch={showCloseSearch ? handleCloseSearch : undefined}
          fontStack={fontStack}
          showCreateGroup={showCreateGroup}
          showCloseSearch={showCloseSearch}
        />

        {hasSearch && !fullResultsOpen && (
          <div className="search-dropdown">
            <div className="search-dropdown-inner">
              {isLoading && (
                <div className="dropdown-helper">
                  Buscando comunidades, perfiles y publicaciones...
                </div>
              )}

              {!isLoading && !hasAnyResults && (
                <div className="dropdown-helper">
                  No se encontraron comunidades ni perfiles con esa búsqueda.
                </div>
              )}

              {!isLoading && previewCommunities.length > 0 && (
                <section className="dropdown-section">
                  <h2 className="dropdown-title">Comunidades</h2>

                  {previewCommunities.map((g) => {
                    const isOwner =
                      !!user && !!g.ownerId && g.ownerId === user.uid;
                    const membershipStatus = isOwner
                      ? "active"
                      : memberMap[g.id] ?? null;

                    const isMember = isOwner || isJoinedStatus(membershipStatus);
                    const isBlocked =
                      !isOwner && isBlockedStatus(membershipStatus);

                    const isPrivate = g.visibility === "private";
                    const isPublic = g.visibility === "public";
                    const hasPendingReq = !!reqMap[g.id];
                    const paidPrivate = isPaidPrivateGroup(g);

const visLabel =
  g.visibility === "public"
    ? "Comunidad pública"
    : g.visibility === "private"
      ? "Comunidad privada"
      : "Comunidad oculta";
                    const price = g.monetization?.priceMonthly ?? null;
                    const cur = g.monetization?.currency ?? null;
                    const serviceDots = buildSearchServiceDots(g);

                    return (
                      <div
                        key={g.id}
                        className="result-item"
                        onClick={() => handleNavigateAndClose(`/groups/${g.id}`)}
                      >
                        <div className="result-grid">
                          <div className="result-main-mobile">
                            <div className="result-avatar">
                              {g.avatarUrl ? (
                                <img
                                  src={g.avatarUrl}
                                  alt={g.name ?? "Comunidad"}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <span className="result-avatar-fallback">
                                  {initialsFromName(g.name ?? "Comunidad")}
                                </span>
                              )}
                            </div>

                            <div className="result-content">
<h3 className="result-name result-name-with-meta">
  <span className="result-name-text">
    {g.name ?? "(sin nombre)"}
  </span>
<span className="result-name-dot visibility-desktop">·</span>
<span className="result-name-visibility">
  <span className="visibility-desktop">{visLabel}</span>
  <span className="visibility-mobile">
    {visLabel.replace("Comunidad ", "").toLowerCase()}
  </span>
</span>

<span className="service-dots-desktop">
  <ServiceDots dots={serviceDots} />
</span>
</h3>

{getDescriptionPreview(g.description) ? (
  <p className="result-description-preview">
    {getDescriptionPreview(g.description)}
  </p>
) : null}

<div className="service-dots-mobile">
  <span className="mobile-visibility-label">
    {visLabel}
  </span>

  {serviceDots.length > 0 ? (
    <>
      <span className="mobile-service-separator">·</span>
      <ServiceDots dots={serviceDots} />
    </>
  ) : null}
</div>

<div className="result-meta">

                                {!isOwner && isBlocked && (
                                  <span className="meta-inline meta-danger">
                                    ({membershipStatusLabel(membershipStatus)})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            className="actions-wrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!isOwner && !isMember && !isBlocked && isPublic && (
                              <button
                                onClick={() => void handleJoinPublic(g.id)}
                                className="primary-btn"
                                type="button"
                              >
                                Unirme
                              </button>
                            )}

                            {!isOwner && !isMember && !isBlocked && paidPrivate && (
<button
  onClick={() => handleOpenSubscription(g.id)}
  className="primary-btn"
  type="button"
>
  💎 Suscribirme
  {price != null ? ` · ${price} ${cur ?? "MXN"}` : ""}
</button>
                            )}

                            {!isOwner &&
                              !isMember &&
                              !isBlocked &&
                              isPrivate &&
                              !paidPrivate && (
                                <>
                                  {!hasPendingReq ? (
                                    <button
                                      onClick={() =>
                                        void handleRequestPrivate(g.id)
                                      }
                                      className="secondary-btn"
                                      type="button"
                                    >
                                      Solicitar acceso
                                    </button>
                                  ) : (
<button
  onClick={() => void handleCancelRequest(g.id)}
  className="secondary-btn"
  type="button"
>
  Cancelar
</button>
                                  )}
                                </>
                              )}

                            {isMember && !isOwner && (
                              <button
                                onClick={() => void handleLeave(g.id, g.ownerId)}
                                className="secondary-btn"
                                type="button"
                              >
                                Salir
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {!isLoading && previewProfiles.length > 0 && (
                <section className="dropdown-section">
                  <h2 className="dropdown-title">Perfiles</h2>

                  {previewProfiles.map((p) => {
                    const fullName =
                      p.displayName?.trim() ||
                      `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() ||
                      p.handle ||
                      "Usuario";

                      const serviceDots = buildSearchServiceDots(p);

                    return (
                      <div
                        key={p.uid}
                        className="result-item"
                        onClick={() => handleNavigateAndClose(`/u/${p.handle}`)}
                      >
                        <div className="result-grid">
<div className="result-main-mobile">
  <div className="result-avatar">
    {p.photoURL ? (
      <img
        src={p.photoURL}
        alt={fullName}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    ) : (
      <span className="result-avatar-fallback">
        {initialsFromName(fullName)}
      </span>
    )}
  </div>

  <div className="result-content">
    <h3 className="result-name result-name-with-meta">
  <span className="result-name-text">{fullName}</span>
  <ServiceDots dots={serviceDots} />
</h3>

    <div className="result-meta">
      <span className="pill">@{p.handle}</span>
    </div>
  </div>
</div>

<div className="profile-cta">Abrir</div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>

            {!isLoading && hasSearch && (
              <div className="dropdown-footer">
                <button
                  type="button"
                  className="more-results-btn"
                  onClick={handleOpenFullResults}
                >
                  Ver más resultados
                </button>
              </div>
            )}
          </div>
        )}

        <SearchResultsExplorerPanel
          open={fullResultsOpen}
          search={search}
          fontStack={fontStack}
          currentUser={user}
          communities={explorerCommunities}
          profiles={filteredProfiles}
          memberMap={memberMap}
          reqMap={reqMap}
          onClose={handleCloseFullResults}
          onNavigate={handleNavigateAndClose}
          onJoinPublic={handleJoinPublic}
          onRequestPrivate={handleRequestPrivate}
          onCancelRequest={handleCancelRequest}
          onLeave={handleLeave}
        />

        {error && <div className="error-card">{error}</div>}
      </div>
    </>
  );
}