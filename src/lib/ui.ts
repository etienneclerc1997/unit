import { toFraction, fractionText, type Precision, PRECISIONS, DEFAULT_PRECISION } from './units';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Escape, swap ' and " for primes, and wrap n/d in a diagonal-fraction span. */
export function prettyHTML(text: string): string {
  return escape(text)
    .replace(/&#39;/g, '′')
    .replace(/&quot;/g, '″')
    .replace(/(\d+)\/(\d+)/g, '<span class="fr">$1/$2</span>');
}

/** Inch value → HTML fraction with a ≈ marker when it was rounded. */
export function inchHTML(inches: number, den: number, approxMark = true): string {
  const f = toFraction(inches, den);
  const approx = approxMark && !f.exact ? '<span class="approx" title="Rounded">≈</span>' : '';
  return approx + prettyHTML(fractionText(f) + '"');
}

export function precisionLabel(p: number): string {
  return `1/${p}`;
}

/** State shared across screens: the Convert tab peeks at the last converted value. */
export const shared = { convPeek: '' };

export function haptic() {
  try {
    navigator.vibrate?.(6);
  } catch {
    /* not supported */
  }
}

/* ---------- Persistence ---------- */

const KEY = 'unit:v1';

export function load<T>(name: string, fallback: T): T {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return name in all ? (all[name] as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(name: string, value: unknown) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    all[name] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function loadPrecision(name: string): Precision {
  const p = load<number>(name, DEFAULT_PRECISION);
  return (PRECISIONS as readonly number[]).includes(p) ? (p as Precision) : DEFAULT_PRECISION;
}

/* ---------- Precision sheet ---------- */

let onPick: ((p: Precision) => void) | null = null;

export function openPrecisionSheet(current: Precision, pick: (p: Precision) => void) {
  onPick = pick;
  document.querySelectorAll<HTMLButtonElement>('.prec-opt').forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.p) === current));
  });
  document.body.classList.add('sheet-open');
  document.querySelector<HTMLElement>('.sheet')?.setAttribute('aria-hidden', 'false');
}

export function closePrecisionSheet() {
  document.body.classList.remove('sheet-open');
  document.querySelector<HTMLElement>('.sheet')?.setAttribute('aria-hidden', 'true');
  onPick = null;
}

export function initPrecisionSheet() {
  document.querySelector('.sheet-scrim')?.addEventListener('click', closePrecisionSheet);
  document.querySelectorAll<HTMLButtonElement>('.prec-opt').forEach((b) => {
    b.addEventListener('click', () => {
      haptic();
      onPick?.(Number(b.dataset.p) as Precision);
      closePrecisionSheet();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePrecisionSheet();
  });
}

/** Long-press support (e.g. hold ⌫ to clear). Returns true from the click handler if a long press fired. */
export function onLongPress(el: HTMLElement, fn: () => void, ms = 450) {
  let timer = 0;
  let fired = false;
  el.addEventListener('pointerdown', () => {
    fired = false;
    timer = window.setTimeout(() => {
      fired = true;
      fn();
    }, ms);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener(
    'click',
    (e) => {
      if (fired) {
        e.stopImmediatePropagation();
        fired = false;
      }
    },
    true,
  );
}
