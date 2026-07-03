"use client";

import { createContext, useContext } from "react";

export type AdminPreviewContextValue = {
  previewUrl: string | null;
  setPreviewUrl: (url: string | null) => void;
};

export const AdminPreviewContext = createContext<AdminPreviewContextValue>({
  previewUrl: null,
  setPreviewUrl: () => {},
});

export function useAdminPreview() {
  return useContext(AdminPreviewContext);
}
