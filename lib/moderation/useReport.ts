"use client";

import { useState, useCallback } from "react";
import type { ReportTargetType } from "./types";

export type ReportTarget = {
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerId: string;
  // Requerido para comentarios y comment_reply
  parentId?: string;
};

type UseReportReturn = {
  reportTarget: ReportTarget | null;
  openReport: (target: ReportTarget) => void;
  closeReport: () => void;
};

export function useReport(): UseReportReturn {
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const openReport = useCallback((target: ReportTarget) => {
    setReportTarget(target);
  }, []);

  const closeReport = useCallback(() => {
    setReportTarget(null);
  }, []);

  return { reportTarget, openReport, closeReport };
}
