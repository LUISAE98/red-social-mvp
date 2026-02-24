import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Group, GroupVisibility } from "@/types/group";

type CreateGroupInput = {
  name: string;
  description: string;
  ownerId: string;
  visibility: GroupVisibility;
  imageUrl?: string | null;
};

export async function createGroup(input: CreateGroupInput): Promise<string> {
  const name = input.name.trim();
  const description = input.description.trim();

  if (name.length < 3) throw new Error("El nombre debe tener al menos 3 caracteres.");
  if (description.length < 10) throw new Error("La descripción debe tener al menos 10 caracteres.");
  if (!input.ownerId) throw new Error("ownerId es requerido.");

  const group: Omit<Group, "id"> = {
    name,
    description,
    imageUrl: input.imageUrl ?? null,

    ownerId: input.ownerId,
    visibility: input.visibility,

    permissions: {
      postingMode: "members",
      commentsEnabled: true,
    },

    monetization: {
      isPaid: false,
      priceMonthly: null,
      currency: null,
    },

    isActive: true,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 1) Crear grupo
  const ref = await addDoc(collection(db, "groups"), group);

  // 2) Crear membership del owner (igual que el grupo manual)
  await setDoc(doc(db, "groups", ref.id, "members", input.ownerId), {
    joinedAt: serverTimestamp(),
    role: "owner",
    status: "active",
  });

  return ref.id;
}
