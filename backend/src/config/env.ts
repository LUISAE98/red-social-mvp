export function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function getEnvOptional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}