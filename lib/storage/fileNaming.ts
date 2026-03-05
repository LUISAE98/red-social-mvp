export function buildFileName(userId: string, originalName: string) {
  const timestamp = Date.now();
  const extension = originalName.split(".").pop();
  return `${userId}_${timestamp}.${extension}`;
}