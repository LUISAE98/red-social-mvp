import { defineSecret } from "firebase-functions/params";

export const muxTokenId = defineSecret("MUX_TOKEN_ID");
export const muxTokenSecret = defineSecret("MUX_TOKEN_SECRET");

export async function createMuxClient() {
  const { default: Mux } = await import("@mux/mux-node");
  return new Mux({
    tokenId: muxTokenId.value(),
    tokenSecret: muxTokenSecret.value(),
  });
}
