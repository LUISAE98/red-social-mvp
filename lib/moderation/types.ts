export const REPORT_TARGET_TYPES = [
  "post",
  "comment",
  "comment_reply",
  "live",
  "live_chat_message",
  "greeting",
  "user",
  "community",
  "meet_greet",
  "exclusive_session",
  // Mensajes directos: se reporta el hilo entero, no un mensaje suelto. El
  // contexto de una conversación privada es lo que la hace juzgable.
  "conversation",
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  "spam",
  "hate_speech",
  "violence",
  "illegal_content",
  "harassment",
  "misinformation",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  hate_speech: "Discurso de odio",
  violence: "Violencia o contenido gráfico",
  illegal_content: "Contenido ilegal",
  harassment: "Acoso o bullying",
  misinformation: "Información falsa",
  other: "Otro",
};

export const REPORT_STATUSES = [
  "pending",
  "reviewing",
  "resolved",
  "dismissed",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const MODERATOR_ACTIONS = [
  "dismiss",
  "warn_user",
  "remove_content",
  "block_user",
  "report_to_authorities",
] as const;

export type ModeratorAction = (typeof MODERATOR_ACTIONS)[number];

export const MODERATOR_ACTION_LABELS: Record<ModeratorAction, string> = {
  dismiss: "Descartar — sin violación",
  warn_user: "Advertir al usuario",
  remove_content: "Eliminar contenido",
  block_user: "Bloquear usuario de la plataforma",
  report_to_authorities: "Reportar a autoridades",
};

export type Report = {
  id: string;
  reporterUid: string;
  targetType: ReportTargetType;
  targetId: string;
  // Para comentarios: postId que contiene el comentario
  parentId: string | null;
  targetOwnerId: string;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  claimedBy: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: ModeratorAction | null;
  resolutionNotes: string | null;
  resolvedBy: string | null;
};

export type AuditLogEntry = {
  id: string;
  actorUid: string;
  action: ModeratorAction | "claim_report";
  reportId: string | null;
  targetType: ReportTargetType | null;
  targetId: string | null;
  targetOwnerId: string | null;
  notes: string | null;
  createdAt: Date;
};
