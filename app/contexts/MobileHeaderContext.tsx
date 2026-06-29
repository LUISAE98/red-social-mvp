"use client";
import { createContext, useContext, useEffect } from "react";

export type MobileHeaderData = {
  avatarUrl: string | null;
  name: string | null;
};

export type MobileHeaderContextValue = MobileHeaderData & {
  setMobileHeader: (data: MobileHeaderData) => void;
};

export const MobileHeaderCtx = createContext<MobileHeaderContextValue>({
  avatarUrl: null,
  name: null,
  setMobileHeader: () => {},
});

export function useSetMobileHeader(avatarUrl: string | null, name: string | null) {
  const { setMobileHeader } = useContext(MobileHeaderCtx);
  useEffect(() => {
    setMobileHeader({ avatarUrl, name });
    return () => setMobileHeader({ avatarUrl: null, name: null });
    // setMobileHeader es estable (viene de useState), excluir es seguro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarUrl, name]);
}
