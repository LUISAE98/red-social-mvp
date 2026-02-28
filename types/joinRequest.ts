import { Timestamp } from "firebase/firestore";

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export type JoinRequest = {
  userId: string;            // = docId
  status: JoinRequestStatus; // pending | approved | rejected
  createdAt: Timestamp;
  updatedAt: Timestamp;

  reviewedAt?: Timestamp;
  reviewedBy?: string;       // uid del owner
  note?: string;             // opcional
};