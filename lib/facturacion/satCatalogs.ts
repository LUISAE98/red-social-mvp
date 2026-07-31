// Catálogos oficiales del SAT (CFDI 4.0) para los buscadores de facturación.
// Fuente: c_RegimenFiscal y c_UsoCFDI del Anexo 20. Se usan en los comboboxes de
// datos fiscales (receptor). El régimen y el uso deben coincidir EXACTO con la
// Constancia de Situación Fiscal del receptor o el SAT rechaza el timbrado.

export type SatEntry = { value: string; label: string };

// c_RegimenFiscal — catálogo completo.
export const REGIMENES: SatEntry[] = [
  { value: "601", label: "601 · General de Ley Personas Morales" },
  { value: "603", label: "603 · Personas Morales con Fines no Lucrativos" },
  { value: "605", label: "605 · Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { value: "606", label: "606 · Arrendamiento" },
  { value: "607", label: "607 · Régimen de Enajenación o Adquisición de Bienes" },
  { value: "608", label: "608 · Demás ingresos" },
  { value: "610", label: "610 · Residentes en el Extranjero sin Establecimiento Permanente" },
  { value: "611", label: "611 · Ingresos por Dividendos (socios y accionistas)" },
  { value: "612", label: "612 · Personas Físicas con Actividades Empresariales y Profesionales" },
  { value: "614", label: "614 · Ingresos por intereses" },
  { value: "615", label: "615 · Régimen de los ingresos por obtención de premios" },
  { value: "616", label: "616 · Sin obligaciones fiscales" },
  { value: "620", label: "620 · Sociedades Cooperativas de Producción que difieren ingresos" },
  { value: "621", label: "621 · Incorporación Fiscal" },
  { value: "622", label: "622 · Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { value: "623", label: "623 · Opcional para Grupos de Sociedades" },
  { value: "624", label: "624 · Coordinados" },
  { value: "625", label: "625 · Actividades Empresariales con ingresos por Plataformas Tecnológicas" },
  { value: "626", label: "626 · Régimen Simplificado de Confianza (RESICO)" },
];

// c_UsoCFDI — usos válidos en CFDI 4.0 (los más comunes para un receptor).
export const USOS_CFDI: SatEntry[] = [
  { value: "G01", label: "G01 · Adquisición de mercancías" },
  { value: "G02", label: "G02 · Devoluciones, descuentos o bonificaciones" },
  { value: "G03", label: "G03 · Gastos en general" },
  { value: "I01", label: "I01 · Construcciones" },
  { value: "I02", label: "I02 · Mobiliario y equipo de oficina por inversiones" },
  { value: "I03", label: "I03 · Equipo de transporte" },
  { value: "I04", label: "I04 · Equipo de cómputo y accesorios" },
  { value: "I05", label: "I05 · Dados, troqueles, moldes, matrices y herramental" },
  { value: "I06", label: "I06 · Comunicaciones telefónicas" },
  { value: "I07", label: "I07 · Comunicaciones satelitales" },
  { value: "I08", label: "I08 · Otra maquinaria y equipo" },
  { value: "D01", label: "D01 · Honorarios médicos, dentales y gastos hospitalarios" },
  { value: "D02", label: "D02 · Gastos médicos por incapacidad o discapacidad" },
  { value: "D03", label: "D03 · Gastos funerales" },
  { value: "D04", label: "D04 · Donativos" },
  { value: "D05", label: "D05 · Intereses reales de créditos hipotecarios" },
  { value: "D06", label: "D06 · Aportaciones voluntarias al SAR" },
  { value: "D07", label: "D07 · Primas por seguros de gastos médicos" },
  { value: "D08", label: "D08 · Gastos de transportación escolar obligatoria" },
  { value: "D09", label: "D09 · Depósitos en cuentas para el ahorro, primas de pensiones" },
  { value: "D10", label: "D10 · Pagos por servicios educativos (colegiaturas)" },
  { value: "S01", label: "S01 · Sin efectos fiscales" },
  { value: "CP01", label: "CP01 · Pagos" },
  { value: "CN01", label: "CN01 · Nómina" },
];
