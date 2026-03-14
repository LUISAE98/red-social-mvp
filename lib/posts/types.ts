import type { Timestamp } from "firebase/firestore";

export type PostMedia = {
  type: "image";
  url: string;
  path?: string;
  width?: number;
  height?: number;
};

export type PostCounts = {
  comments?: number;
  likes?: number;
};

export type Post = {
  id: string;
  text: string;
  createdAt?: Timestamp | null;
  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;
  groupId: string;
  isDeleted: boolean;

  access?: "free" | "paid";
  media?: PostMedia[];
  counts?: PostCounts;
};

export type Comment = {
  id: string;
  text: string;
  createdAt?: Timestamp | null;
  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;
};
