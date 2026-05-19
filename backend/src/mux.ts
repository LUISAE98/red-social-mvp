import Mux from "@mux/mux-node";
import { defineSecret } from "firebase-functions/params";

export const muxTokenId = defineSecret("MUX_TOKEN_ID");
export const muxTokenSecret = defineSecret("MUX_TOKEN_SECRET");

export function createMuxClient() {
  return new Mux({
    tokenId: muxTokenId.value(),
    tokenSecret: muxTokenSecret.value(),
  });
}