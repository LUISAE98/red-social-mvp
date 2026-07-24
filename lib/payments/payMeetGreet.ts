// Wrapper cliente del callable `payMeetGreet` (cobro de "Tiempo contigo").

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayMeetGreetInput = {
  requestId: string;
  token: string;
  paymentMethodId: string;
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
};

export type PayMeetGreetResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payMeetGreet(
  input: PayMeetGreetInput
): Promise<PayMeetGreetResult> {
  const fn = httpsCallable<PayMeetGreetInput, PayMeetGreetResult>(
    functions,
    "payMeetGreet"
  );
  const res = await fn(input);
  return res.data;
}
