import { describe, it, expect } from "vitest";
import {
  netFromGross,
  WALLET_COMMISSION_RATE,
  WALLET_NET_RATE,
} from "../src/wallet/ledger";

// Aritmética del dinero. Una regresión aquí se traduce directo en creadores que
// cobran de más o de menos, así que estos tests FIJAN el contrato.
describe("wallet/ledger — netFromGross (comisión del 25%)", () => {
  it("el contrato de comisión es 0.25 (neto 0.75)", () => {
    // Si alguien cambia la comisión sin querer, este test falla en rojo.
    expect(WALLET_COMMISSION_RATE).toBe(0.25);
    expect(WALLET_NET_RATE).toBeCloseTo(0.75, 10);
  });

  it("neto de 100 = 75.00 exacto", () => {
    expect(netFromGross(100)).toBe(75);
  });

  it("redondea a 2 decimales sin arrastre de flotante", () => {
    // 10.1 * 0.75 = 7.5749… (flotante) -> 7.57
    expect(netFromGross(10.1)).toBe(7.57);
    // 0.07 * 0.75 = 0.0525 -> 0.05
    expect(netFromGross(0.07)).toBe(0.05);
    // 99.99 * 0.75 = 74.9925 -> 74.99
    expect(netFromGross(99.99)).toBe(74.99);
  });

  it("nunca devuelve más de 2 decimales", () => {
    for (const gross of [1, 3.33, 7.7, 12.34, 199.95, 1000.01]) {
      const net = netFromGross(gross);
      expect(Number(net.toFixed(2))).toBe(net);
    }
  });

  it("el neto siempre es menor que el bruto (hay comisión)", () => {
    for (const gross of [1, 50, 100, 999.99]) {
      expect(netFromGross(gross)).toBeLessThan(gross);
    }
  });

  it("bruto 0 -> neto 0", () => {
    expect(netFromGross(0)).toBe(0);
  });
});
