// PR-36 — Formato de moneda estilo Costa Rica.
//
// Convención visual: "1.000,00" (separador de miles con punto, decimal con
// coma, siempre 2 decimales). Aplica SOLO a la capa de presentación: el
// estado interno y los payloads al backend siguen siendo strings/Decimals
// canónicos con punto decimal y sin separadores ("1000.00", "142.86").

const MONEY_DECIMALS = 2;

/**
 * Formatea un número como moneda estilo CR: separador de miles "." y decimal
 * ",", siempre con 2 decimales. Útil para inputs en blur y para columnas de
 * lectura. Acepta string para tolerar el `salePrice` que el backend
 * devuelve como string.
 *
 * formatMoney(1000)       → "1.000,00"
 * formatMoney(1428.57)    → "1.428,57"
 * formatMoney(0)          → "0,00"
 * formatMoney("142.86")   → "142,86"
 * formatMoney(undefined)  → "0,00"  (tolerante: facilita uso desde forms sin valor inicial)
 */
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return formatNumber(0);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return formatNumber(0);
  return formatNumber(n);
}

function formatNumber(n: number): string {
  // Intl con `de-DE` produce "1.000,00" exactamente como queremos (separador
  // miles con punto, decimal con coma). Usar `es-CR` daría "₡1.000,00" con
  // símbolo de moneda o "1 000,00" según el modo — `de-DE` es portable.
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: MONEY_DECIMALS,
    maximumFractionDigits: MONEY_DECIMALS,
  }).format(n);
}

/**
 * Convierte un texto con formato CR (o canónico) a number. Tolerante a:
 * - Punto como separador de miles ("1.000,00")
 * - Coma como separador decimal ("1428,57")
 * - Punto como decimal canónico ("142.86")
 * - Espacios y caracteres no numéricos alrededor
 * - Vacío → 0
 *
 * parseMoney("1.000,00") → 1000
 * parseMoney("1.428,57") → 1428.57
 * parseMoney("142,86")   → 142.86
 * parseMoney("142.86")   → 142.86  (canónico también pasa)
 * parseMoney("1000")     → 1000
 * parseMoney("")         → 0
 * parseMoney("ab,cd")    → NaN     (no se interpreta como número)
 *
 * Regla de desambiguación:
 * - Si el texto contiene UNA coma y CERO o MÁS puntos: los puntos son
 *   separadores de miles, la coma es el decimal. ("1.234,56" → 1234.56)
 * - Si solo hay puntos: el último punto es el decimal solo si seguido de
 *   1–2 dígitos; si no, todos los puntos son separadores de miles.
 *   ("1.234"  → 1234   tratado como miles)
 *   ("1.234.56" → ambiguo → tratamos último como decimal solo si len(decimal)<=2)
 *   ("142.86" → 142.86, último bloque de 2 dígitos → decimal)
 * - Sin puntos ni comas → entero limpio.
 */
export function parseMoney(text: string | number | null | undefined): number {
  if (typeof text === 'number') return Number.isFinite(text) ? text : NaN;
  if (text === null || text === undefined) return 0;
  const trimmed = String(text).trim();
  if (trimmed === '') return 0;
  // Limpia espacios internos.
  const clean = trimmed.replace(/\s+/g, '');
  // Solo dígitos, puntos, comas y signo. Otros caracteres → NaN.
  if (!/^-?[\d.,]+$/.test(clean)) return NaN;

  const hasComma = clean.includes(',');
  const hasDot = clean.includes('.');
  let canonical: string;

  if (hasComma) {
    // Coma manda como decimal; puntos son miles.
    const lastComma = clean.lastIndexOf(',');
    const intPart = clean.slice(0, lastComma).replace(/\./g, '');
    const decPart = clean.slice(lastComma + 1);
    if (decPart.includes(',')) return NaN; // dos comas → ambiguo, rechazar
    canonical = decPart ? `${intPart}.${decPart}` : intPart;
  } else if (hasDot) {
    const parts = clean.split('.');
    const last = parts[parts.length - 1];
    if (parts.length >= 2 && last.length <= 2 && parts.slice(0, -1).every((p) => p.length > 0)) {
      // Último bloque es el decimal canónico ("142.86", "1000.5").
      const intPart = parts.slice(0, -1).join('');
      canonical = `${intPart}.${last}`;
    } else {
      // Todos los puntos son separadores de miles ("1.234", "1.234.567").
      canonical = parts.join('');
    }
  } else {
    canonical = clean;
  }

  const n = Number(canonical);
  return Number.isFinite(n) ? n : NaN;
}
