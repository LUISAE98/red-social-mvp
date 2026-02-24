export type GroupVisibility = "public" | "private" | "hidden";
export type PostingMode = "members" | "owner_only";

export interface Group {
  id?: string;

  name: string;
  description: string;
  imageUrl: string | null;

  ownerId: string;
  visibility: GroupVisibility;

  permissions: {
    postingMode: PostingMode;
    commentsEnabled: boolean;
  };

  monetization: {
    isPaid: boolean;
    priceMonthly: number | null;
    currency: "MXN" | null;
  };

  isActive: boolean;

  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp
}
