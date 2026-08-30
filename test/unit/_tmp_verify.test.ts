import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { BUYABLE_COUNTRIES, PAYABLE_COUNTRIES, formatCountryNames } from "@/lib/i18n/countryNames";

it("verifica", () => {
  const l: string[] = [];
  l.push("compra=" + BUYABLE_COUNTRIES.length + "  cobro=" + PAYABLE_COUNTRIES.length);
  for (const loc of ["es", "en", "de", "ja", "dv"]) {
    const compra = formatCountryNames(BUYABLE_COUNTRIES, loc) ?? "";
    const cobro = formatCountryNames(PAYABLE_COUNTRIES, loc) ?? "";
    l.push("[" + loc + "] compra " + compra.split(", ").length + " nombres, " + compra.length + " chars");
    l.push("      " + compra.slice(0, 150) + " ...");
    l.push("      cobro " + cobro.split(", ").length + " nombres");
    l.push("      HK -> " + (compra.includes("Hong Kong") ? "Hong Kong OK" : "REVISAR"));
  }
  writeFileSync("C:/Users/luis/AppData/Local/Temp/claude/c--Users-luis-red-social-mvp/f931aa07-2dd3-4bd6-b530-dea4595a4a21/scratchpad/salida.txt", l.join("\n"), "utf8");
});
