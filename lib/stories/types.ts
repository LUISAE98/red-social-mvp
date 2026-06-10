import type { Timestamp } from "firebase/firestore";

export type StoryType = "saludo" | "consejo";

export type StoryDoc = {
  id: string;
  creatorId: string;
  type: StoryType;
  muxPlaybackId: string | null;
  thumbnailUrl: string | null;
  videoDuration: number | null;
  greetingRequestId: string;
  source: "profile" | "group";
  groupId: string | null;
  createdAt: Timestamp | null;
};

export type StoryViewDoc = {
  storyId: string;
  viewedAt: Timestamp | null;
};
