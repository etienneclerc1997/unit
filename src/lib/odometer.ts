// Rolling-digit readout, like a mechanical counter. Each digit is a wheel
// (a strip of 0–9 repeated three times) that rolls the short way round to its
// next value, so 9 → 0 rolls forward one step instead of spinning back.

const COPIES = 3;

class Wheel {
  el: HTMLElement;
  strip: HTMLElement;
  pos = 10; // index into the strip; kept in the middle copy at rest

  constructor(parent: HTMLElement) {
    this.el = document.createElement('span');
    this.el.className = 'odo-wheel';
    this.strip = document.createElement('span');
    this.strip.className = 'odo-strip';
    for (let i = 0; i < 10 * COPIES; i++) {
      const d = document.createElement('span');
      d.textContent = String(i % 10);
      this.strip.append(d);
    }
    this.el.append(this.strip);
    parent.append(this.el);
    this.strip.addEventListener('transitionend', () => this.recenter());
    this.apply(false);
  }

  set(digit: number) {
    const delta = ((digit - (this.pos % 10) + 15) % 10) - 5; // -5..4: the short way round
    if (delta === 0) return;
    // Rolls that interrupt each other never reach transitionend; keep within the strip.
    if (this.pos + delta < 1 || this.pos + delta > 10 * COPIES - 2) this.recenter();
    this.pos += delta;
    this.apply(true);
  }

  private apply(animate: boolean) {
    this.strip.style.transition = animate ? '' : 'none';
    this.strip.style.setProperty('--p', String(this.pos));
    if (!animate) void this.strip.offsetHeight; // commit the jump before transitions resume
  }

  /** After a roll, jump back to the middle copy (same digit, no visible change). */
  private recenter() {
    const p = 10 + (this.pos % 10);
    if (p === this.pos) return;
    this.pos = p;
    this.apply(false);
  }
}

/** Formats a signed value as `−000.00` with greyed leading zeros. */
export class Odometer {
  private sign: HTMLElement;
  private ints: Wheel[] = [];
  private decs: Wheel[] = [];

  constructor(root: HTMLElement, intDigits = 3, decDigits = 2) {
    root.classList.add('odo');
    root.textContent = '';
    this.sign = document.createElement('span');
    this.sign.className = 'odo-sign';
    this.sign.textContent = '−';
    root.append(this.sign);
    for (let i = 0; i < intDigits; i++) this.ints.push(new Wheel(root));
    const dot = document.createElement('span');
    dot.className = 'odo-dot';
    dot.textContent = '.';
    root.append(dot);
    for (let i = 0; i < decDigits; i++) this.decs.push(new Wheel(root));
    const deg = document.createElement('span');
    deg.className = 'odo-unit';
    deg.textContent = '°';
    root.append(deg);
    this.decs[this.decs.length - 1].el.classList.add('odo-last');
  }

  set(value: number) {
    const fixed = Math.abs(value).toFixed(this.decs.length);
    const [int, dec] = fixed.split('.');
    const padded = int.padStart(this.ints.length, '0').slice(-this.ints.length);
    const leadingZeros = this.ints.length - int.length;
    this.ints.forEach((w, i) => {
      w.set(Number(padded[i]));
      w.el.classList.toggle('odo-lead', i < leadingZeros);
    });
    this.decs.forEach((w, i) => w.set(Number(dec[i])));
    this.sign.classList.toggle('on', value < 0 && Number(fixed) !== 0);
  }
}
