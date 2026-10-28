// Canonical internal unit is the inch. Every length is stored as a float in inches.

export const MM_PER_IN = 25.4;

export const PRECISIONS = [4, 8, 16, 32, 64, 1000] as const;
export type Precision = (typeof PRECISIONS)[number];
export const DEFAULT_PRECISION: Precision = 32;

export type FieldKey = 'mm' | 'cm' | 'in' | 'inFrac' | 'ftFrac' | 'm';

/** How the real value compares to the displayed one: 1 = slightly larger, -1 = slightly smaller. */
export type RoundDir = -1 | 0 | 1;

export interface Fraction {
  neg: boolean;
  whole: number;
  num: number;
  den: number;
  dir: RoundDir;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const EPS = 1e-6;

/** Imperial denominators a thousandth may simplify to (1/1000 can only land exactly on 1/2, 1/4, 1/8). */
const IMPERIAL = new Set([1, 2, 4, 8, 16, 32, 64]);

/**
 * Round an inch value to the nearest 1/den and reduce to the simplest fraction.
 * With 1/1000, values stay in thousandths (3mm → 118/1000) unless they fall
 * exactly on a 64th or simplify to an imperial denominator.
 */
export function toFraction(inches: number, den: number): Fraction {
  const neg = inches < 0;
  const abs = Math.abs(inches);
  let d = den;
  let rounded: number;

  const in64ths = abs * 64;
  if (den === 1000 && Math.abs(in64ths - Math.round(in64ths)) < EPS) {
    d = 64;
    rounded = Math.round(in64ths);
  } else {
    rounded = Math.round(abs * den);
  }

  const diff = abs * d - rounded;
  const dir: RoundDir = Math.abs(diff) < EPS ? 0 : (diff > 0) !== neg ? 1 : -1;

  const whole = Math.floor(rounded / d);
  let num = rounded % d;
  if (num > 0) {
    const g = gcd(num, d);
    if (den !== 1000 || IMPERIAL.has(d / g)) {
      num /= g;
      d /= g;
    }
  }
  return { neg: neg && rounded !== 0, whole, num, den: d, dir };
}

/** Plain-text inch fraction, e.g. `1 1/32"`. */
export function formatInchFraction(inches: number, den: number, mark = '"'): string {
  const f = toFraction(inches, den);
  return fractionText(f) + mark;
}

export function fractionText(f: Fraction): string {
  const sign = f.neg ? '-' : '';
  if (f.num === 0) return `${sign}${f.whole}`;
  if (f.whole === 0) return `${sign}${f.num}/${f.den}`;
  return `${sign}${f.whole} ${f.num}/${f.den}`;
}

/** Feet + inch fraction, e.g. `5' 3 1/2"`, and which way it was rounded. */
export function feetFraction(inches: number, den: number): { text: string; dir: RoundDir } {
  const neg = inches < 0;
  const abs = Math.abs(inches);
  let feet = Math.floor(abs / 12);
  let rest = toFraction(abs - feet * 12, den);
  const dir = (neg ? -rest.dir : rest.dir) as RoundDir;
  // Rounding can push the inch part up to a full foot.
  if (rest.whole >= 12) {
    feet += 1;
    rest = toFraction(0, den);
  }
  const sign = neg && (feet > 0 || rest.whole > 0 || rest.num > 0) ? '-' : '';
  if (rest.whole === 0 && rest.num === 0) return { text: `${sign}${feet}'`, dir };
  return { text: `${sign}${feet}' ${fractionText(rest)}"`, dir };
}

export function formatFeetFraction(inches: number, den: number): string {
  return feetFraction(inches, den).text;
}

export function formatDecimal(value: number, decimals: number): string {
  const s = value.toFixed(decimals);
  const trimmed = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return trimmed === '-0' ? '0' : trimmed;
}

/* ---------- Parsing ---------- */

/** Parses `3`, `3.5`, `1/2`, `3 1/2`, `3-1/2`, with optional trailing `"`. */
export function parseInchFraction(text: string): number | null {
  const s = text.trim().replace(/"$/, '').trim();
  if (s === '') return null;
  let m = s.match(/^(-)?(\d+(?:\.\d+)?)$/);
  if (m) return (m[1] ? -1 : 1) * parseFloat(m[2]);
  m = s.match(/^(-)?(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/);
  if (m) {
    const den = parseInt(m[4], 10);
    if (den === 0) return null;
    const whole = m[2] ? parseInt(m[2], 10) : 0;
    return (m[1] ? -1 : 1) * (whole + parseInt(m[3], 10) / den);
  }
  return null;
}

/** Parses `5'`, `5.5'`, `5' 3 1/2"`, `5'3`, or a bare number (read as feet). */
export function parseFeetFraction(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const idx = body.indexOf("'");
  if (idx === -1) {
    const n = parseDecimal(body);
    return n === null ? null : (neg ? -1 : 1) * n * 12;
  }
  const feetPart = body.slice(0, idx).trim();
  const inchPart = body.slice(idx + 1).trim();
  const feet = feetPart === '' ? 0 : parseDecimal(feetPart);
  if (feet === null) return null;
  const inches = inchPart === '' ? 0 : parseInchFraction(inchPart);
  if (inches === null || inches < 0) return null;
  return (neg ? -1 : 1) * (feet * 12 + inches);
}

export function parseDecimal(text: string): number | null {
  const s = text.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return parseFloat(s);
}

/* ---------- Field table ---------- */

export interface FieldDef {
  key: FieldKey;
  label: string;
  unit: string;
  fractional: boolean;
  parse: (text: string) => number | null;
  /** Editable text for the field (feet: `5'3 1/2`, units are drawn by the UI). */
  format: (inches: number, den: number) => string;
  /** Rounding direction of the formatted value, for fraction fields. */
  dir?: (inches: number, den: number) => RoundDir;
}

export const FIELDS: FieldDef[] = [
  {
    key: 'mm', label: 'Millimeters', unit: 'mm', fractional: false,
    parse: (t) => mapNum(parseDecimal(t), (n) => n / MM_PER_IN),
    format: (v) => formatDecimal(v * MM_PER_IN, 2),
  },
  {
    key: 'cm', label: 'Centimeters', unit: 'cm', fractional: false,
    parse: (t) => mapNum(parseDecimal(t), (n) => (n * 10) / MM_PER_IN),
    format: (v) => formatDecimal((v * MM_PER_IN) / 10, 3),
  },
  {
    key: 'in', label: 'Inches', unit: 'in', fractional: false,
    parse: parseDecimal,
    format: (v) => formatDecimal(v, 4),
  },
  {
    key: 'inFrac', label: 'Inch fraction', unit: '"', fractional: true,
    parse: parseInchFraction,
    format: (v, den) => formatInchFraction(v, den, ''),
    dir: (v, den) => toFraction(v, den).dir,
  },
  {
    key: 'ftFrac', label: 'Feet', unit: '', fractional: true,
    parse: parseFeetFraction,
    format: (v, den) => formatFeetFraction(v, den).replace("' ", "'").replace(/"$/, ''),
    dir: (v, den) => feetFraction(v, den).dir,
  },
  {
    key: 'm', label: 'Meters', unit: 'm', fractional: false,
    parse: (t) => mapNum(parseDecimal(t), (n) => (n * 1000) / MM_PER_IN),
    format: (v) => formatDecimal((v * MM_PER_IN) / 1000, 4),
  },
];

function mapNum(n: number | null, f: (n: number) => number): number | null {
  return n === null ? null : f(n);
}
