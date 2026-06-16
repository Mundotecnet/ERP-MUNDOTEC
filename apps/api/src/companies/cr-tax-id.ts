/**
 * Validación de identificación tributaria de Costa Rica:
 *
 * - Cédula jurídica: 10 dígitos en bloques `<tipo>-<código>-<consecutivo>`,
 *   con separadores opcionales — `3-101-123456`, `3101123456`, `3-101-1234567`.
 * - Cédula física: 9 a 10 dígitos sin guiones (`108880123`).
 * - DIMEX: 11 a 12 dígitos sin guiones (`100012345678`).
 * - NITE: 10 dígitos comenzando en `5`.
 *
 * Para la primera fase no se contacta a Hacienda ni al TSE — solo se valida
 * el formato. Cuando el sprint fiscal toque la integración real, este
 * validador se reemplazará por una consulta a TRIBU-CR / TSE.
 *
 * Devuelve el tax_id normalizado a `<tipo>-<código>-<consecutivo>` para
 * jurídicas y solo dígitos para los demás casos. Lanza `Error` con mensaje
 * descriptivo si el formato no es válido.
 */
export function normalizeCostaRicaTaxId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('La identificación tributaria es requerida.');
  }
  const digits = trimmed.replace(/-/g, '');
  if (!/^\d+$/.test(digits)) {
    throw new Error('La identificación tributaria solo admite dígitos y guiones.');
  }

  // Jurídica: 10 dígitos en formato <tipo>-<código>-<consecutivo>.
  // Tipo: 1 dígito (3 = S.A./asociación, 4 = sociedad civil, etc.).
  // Código: 3 dígitos.
  // Consecutivo: 6 dígitos.
  if (digits.length === 10) {
    const tipo = digits.slice(0, 1);
    const codigo = digits.slice(1, 4);
    const consecutivo = digits.slice(4, 10);
    if (/^[2-7]$/.test(tipo)) {
      return `${tipo}-${codigo}-${consecutivo}`;
    }
    // 10 dígitos sin tipo válido → asumimos NITE / DIMEX.
    return digits;
  }

  // Física CR (9 dígitos) o DIMEX (11-12).
  if (digits.length === 9 || digits.length === 11 || digits.length === 12) {
    return digits;
  }

  throw new Error(
    `Formato de identificación tributaria no reconocido. ` +
      `Se acepta cédula jurídica (10 dígitos), física (9), DIMEX (11-12) o NITE.`,
  );
}
