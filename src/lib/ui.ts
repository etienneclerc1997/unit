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

/** A short buzz and a soft mechanical click, for every press. */
export function haptic() {
  try {
    // Phone motors need ~10ms to spin up at all; 6ms was too short to feel.
    navigator.vibrate?.(12);
  } catch {
    /* not supported */
  }
  click();
}

/* The click: a few milliseconds of filtered noise, made once and replayed. As an
   "ambient" sound it follows the silent switch on iPhone and media volume elsewhere. */
let audio: AudioContext | null = null;
let clickBuffer: AudioBuffer | null = null;

function click() {
  try {
    if (!audio) {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'ambient';
      audio = new AudioContext();
      const n = Math.round(audio.sampleRate * 0.012);
      clickBuffer = audio.createBuffer(1, n, audio.sampleRate);
      const data = clickBuffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n / 7));
    }
    if (audio.state === 'suspended') audio.resume();
    const src = audio.createBufferSource();
    src.buffer = clickBuffer;
    const tone = audio.createBiquadFilter();
    tone.type = 'bandpass';
    tone.frequency.value = 3400;
    tone.Q.value = 0.8;
    const level = audio.createGain();
    level.gain.value = 0.28;
    src.connect(tone).connect(level).connect(audio.destination);
    src.start();
  } catch {
    /* no audio */
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
let dialAt = -1; // the step under the index

const dialTrack = () => document.querySelector<HTMLElement>('.prec-track')!;
const dialSteps = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.prec-opt'));
const stepWidth = () => dialSteps()[0].offsetWidth;

function markStep(i: number) {
  dialAt = i;
  dialSteps().forEach((b, n) => b.setAttribute('aria-checked', String(n === i)));
}

export function openPrecisionSheet(current: Precision, pick: (p: Precision) => void) {
  onPick = pick;
  const i = Math.max(0, PRECISIONS.indexOf(current));
  markStep(i);
  dialTrack().scrollLeft = i * stepWidth();
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
  document.querySelector('.sheet-done')?.addEventListener('click', () => (haptic(), closePrecisionSheet()));
  // Turning the dial: every step that passes the index clicks and applies at once.
  const track = dialTrack();
  track.addEventListener(
    'scroll',
    () => {
      const i = Math.max(0, Math.min(PRECISIONS.length - 1, Math.round(track.scrollLeft / stepWidth())));
      if (i === dialAt || !onPick) return;
      markStep(i);
      haptic();
      onPick(PRECISIONS[i]);
    },
    { passive: true },
  );
  dialSteps().forEach((b, i) =>
    b.addEventListener('click', () => track.scrollTo({ left: i * stepWidth(), behavior: 'smooth' })),
  );
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
    suppressNextClick(sheet, e);
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

/**
 * Phones drop the click of a tap that comes right after a swipe (the tap only
 * stops the swipe's fling), so for a moment after every screen change buttons
 * seemed dead. When a clean tap on a button gets no click, click it ourselves,
 * and ignore the real one should it turn up late.
 */
export function rescueDroppedTaps() {
  let down: { el: HTMLButtonElement; id: number; x: number; y: number } | null = null;
  const button = (e: Event) => (e.target as HTMLElement).closest?.<HTMLButtonElement>('button') ?? null;
  document.addEventListener('pointerdown', (e) => {
    const el = button(e);
    down = el && e.isPrimary ? { el, id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  }, true);
  document.addEventListener('pointercancel', () => (down = null), true);
  document.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || button(e) !== d.el) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    let clicked = false;
    const seen = () => (clicked = true);
    d.el.addEventListener('click', seen, { capture: true, once: true });
    setTimeout(() => {
      d.el.removeEventListener('click', seen, { capture: true });
      if (clicked || d.el.disabled || !d.el.isConnected) return;
      d.el.click();
      const late = (ev: Event) => {
        if (!ev.isTrusted) return;
        ev.stopImmediatePropagation();
        ev.preventDefault();
      };
      d.el.addEventListener('click', late, { capture: true });
      setTimeout(() => d.el.removeEventListener('click', late, { capture: true }), 500);
    }, 80);
  }, true);
}

/**
 * Swallow the click that ends a mouse drag, so a key or option isn't triggered by
 * accident. A touch drag never ends in a click, so there the next real tap is kept.
 */
export function suppressNextClick(el: HTMLElement, e: PointerEvent) {
  if (e.pointerType !== 'mouse') return;
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
