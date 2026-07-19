// Cifra enmascarada: conserva el símbolo/código de moneda y pinta un punto por
// cada dígito. Cada punto ocupa el ancho de un dígito (1ch) y va centrado, para
// que respeten el espacio de cada número en vez de amontonarse.
// Ej.: "$1,234.56" → "$ • • • • • •" (con el mismo ancho que los 6 dígitos).
export default function MaskedAmount({ formatted }: { formatted: string }) {
  const digits = formatted.match(/\d/g);
  if (!digits) return <>{formatted}</>;

  const firstDigit = formatted.search(/\d/);
  const afterLastDigit =
    formatted.length - formatted.split("").reverse().join("").search(/\d/);
  const prefix = formatted.slice(0, firstDigit);
  const suffix = formatted.slice(afterLastDigit);

  return (
    <>
      {prefix}
      {digits.map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ display: "inline-block", width: "1ch", textAlign: "center" }}
        >
          •
        </span>
      ))}
      {suffix}
    </>
  );
}
