import { toFraction, fractionText, type Precision, type RoundDir, PRECISIONS, DEFAULT_PRECISION } from './units';

export const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Escape, swap ' and " for primes, and wrap n/d in a diagonal-fraction span. */
export function prettyHTML(text: string): string {
  return escape(text)
    .replace(/&#39;/g, '′')
    .replace(/&quot;/g, '″')
    .replace(/(\d+)\/(\d+)/g, '<span class="fr">$1/$2</span>');
}

/** Small mark after a rounded value: + = the real value is a bit larger, − = a bit smaller. */
export function roundHTML(dir: RoundDir): string {
  if (dir === 0) return '';
  const up = dir > 0;
  return `<span class="rd ${up ? 'up' : 'down'}" role="img" aria-label="${up ? 'slightly more' : 'slightly less'}">${up ? '+' : '−'}</span>`;
}

/** Inch value → HTML fraction, marked when it had to be rounded. */
export function inchHTML(inches: number, den: number): string {
  const f = toFraction(inches, den);
  return prettyHTML(fractionText(f) + '"') + roundHTML(f.dir);
}

export function precisionLabel(p: number): string {
  return `1/${p}`;
}

/** State shared across screens: the Convert tab peeks at the last converted value (as HTML). */
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

export function loadPrecision(name: string, fallback: Precision = DEFAULT_PRECISION): Precision {
  const p = load<number>(name, fallback);
  return (PRECISIONS as readonly number[]).includes(p) ? (p as Precision) : fallback;
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
  initSheetDrag(document.querySelector<HTMLElement>('.sheet')!);
}

/** Drag the sheet down to dismiss; a short or slow drag springs back. */
function initSheetDrag(sheet: HTMLElement) {
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let id: number | null = null;
  let dragging = false;

  sheet.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    dragging = false;
  });

  sheet.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dy = e.clientY - startY;
    if (!dragging) {
      // The grip drags immediately; elsewhere wait for a clear downward pull.
      const onGrip = (e.target as HTMLElement).closest('.sheet-grip-area');
      if (!onGrip && dy < 8) return;
      dragging = true;
      sheet.setPointerCapture(e.pointerId);
      sheet.style.transition = 'none';
    }
    const dt = Math.max(1, e.timeStamp - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    // Resist upward drags.
    const y = dy > 0 ? dy : dy / 6;
    sheet.style.transform = `translateY(${y}px)`;
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!dragging) return;
    const dy = e.clientY - startY;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.5) closePrecisionSheet();
    suppressNextClick(sheet);
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

/* ---------- Denominator strip ---------- */

/**
 * Show the strip when the text being typed ends with "/". `before` is everything
 * before the slash; denominators that can't make a proper fraction are dimmed.
 */
export function updateDenoms(el: HTMLElement, before: string | null) {
  const show = before !== null;
  el.classList.toggle('show', show);
  el.setAttribute('aria-hidden', String(!show));
  if (!show) return;
  const numerator = Number(before.match(/(\d+)$/)?.[1] ?? 0);
  el.querySelectorAll<HTMLButtonElement>('.denom').forEach((b) => {
    b.disabled = Number(b.dataset.d) <= numerator;
    b.tabIndex = show ? 0 : -1;
  });
}

export function onDenom(el: HTMLElement, pick: (digits: string[]) => void) {
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.denom');
    if (!b || !el.classList.contains('show')) return;
    haptic();
    pick([...b.dataset.d!]);
  });
}

/** Swallow the click that ends a drag, so a key or option isn't triggered by accident. */
export function suppressNextClick(el: HTMLElement) {
  const stop = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  el.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 80);
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
