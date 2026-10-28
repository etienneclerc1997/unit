// Calculator engine. The expression is a flat list of key tokens so backspace
// removes exactly what one key press added, and a cursor index lets you edit
// anywhere. Every value is computed in inches; a number typed without a unit is
// inches (after × or ÷ it reads as a plain count, which is the same arithmetic).

export type Op = '+' | '−' | '×' | '÷';
export type Unit = "'" | '"' | 'mm' | 'cm';

// Divide rather than multiply by 1/25.4 so 25.4mm comes out as exactly 1".
const TO_INCHES: Record<Unit, (v: number) => number> = {
  "'": (v) => v * 12,
  '"': (v) => v,
  mm: (v) => v / 25.4,
  cm: (v) => v / 2.54,
};

const OPS = new Set<string>(['+', '−', '×', '÷']);
const UNITS = new Set<string>(["'", '"', 'mm', 'cm']);
const isDigit = (t: string | undefined) => t !== undefined && /^\d$/.test(t);
/** Characters that make up a number literal: `12`, `2.5`, `1/32`, `1 1/32`. */
const isNumChar = (t: string | undefined) => isDigit(t) || t === '.' || t === '/' || t === ' ';
export const isOp = (t: string | undefined): t is Op => t !== undefined && OPS.has(t);
export const isUnit = (t: string | undefined): t is Unit => t !== undefined && UNITS.has(t);

/* ---------- Lexing ---------- */

/** Every item knows the token range [s, e) it came from, for cursor placement. */
export type Item = { s: number; e: number } & (
  | { k: 'num'; text: string }
  | { k: 'ans' }
  | { k: 'op'; v: Op }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'unit'; v: Unit }
);

export function lex(tokens: string[]): Item[] {
  const items: Item[] = [];
  tokens.forEach((t, i) => {
    const last = items[items.length - 1];
    const at = { s: i, e: i + 1 };
    if (isNumChar(t)) {
      if (last?.k === 'num' && last.e === i) {
        last.text += t;
        last.e = i + 1;
      } else items.push({ ...at, k: 'num', text: t });
    } else if (t === 'ANS') items.push({ ...at, k: 'ans' });
    else if (isOp(t)) items.push({ ...at, k: 'op', v: t });
    else if (t === '(') items.push({ ...at, k: 'lp' });
    else if (t === ')') items.push({ ...at, k: 'rp' });
    else if (isUnit(t)) items.push({ ...at, k: 'unit', v: t });
  });
  return items;
}

/* ---------- Parsing ---------- */

class ParseError extends Error {}

function literal(raw: string): number {
  const text = raw.replace(/ +$/, '');
  let m = text.match(/^(\d+\.?\d*|\.\d+)$/);
  if (m) return parseFloat(m[1]);
  m = text.match(/^(?:(\d+) )?(\d+)\/(\d+)$/);
  if (m) {
    const den = Number(m[3]);
    if (den === 0) throw new ParseError('div0');
    return Number(m[1] ?? 0) + Number(m[2]) / den;
  }
  // A mixed number still being typed ("1 1") counts as its whole part.
  m = text.match(/^(\d+) \d+$/);
  if (m) return Number(m[1]);
  throw new ParseError(text);
}

class Parser {
  i = 0;
  items: Item[];
  ans: number;
  lenient: boolean;
  constructor(items: Item[], ans: number, lenient: boolean) {
    this.items = items;
    this.ans = ans;
    this.lenient = lenient;
  }

  peek() { return this.items[this.i]; }
  next() { return this.items[this.i++]; }

  run(): number {
    const v = this.expr();
    if (this.i < this.items.length) throw new ParseError('trailing');
    return v;
  }

  expr(): number {
    let v = this.term();
    for (let p = this.peek(); p?.k === 'op' && (p.v === '+' || p.v === '−'); p = this.peek()) {
      this.next();
      const r = this.term();
      v = p.v === '+' ? v + r : v - r;
    }
    return v;
  }

  term(): number {
    let v = this.unary();
    for (;;) {
      const p = this.peek();
      if (p?.k === 'op' && (p.v === '×' || p.v === '÷')) {
        this.next();
        const r = this.unary();
        if (p.v === '÷' && r === 0) throw new ParseError('div0');
        v = p.v === '×' ? v * r : v / r;
      } else if (p && (p.k === 'lp' || p.k === 'num' || p.k === 'ans')) {
        v *= this.unary(); // implicit multiplication: 2(3+1)
      } else return v;
    }
  }

  unary(): number {
    const p = this.peek();
    if (p?.k === 'op' && p.v === '−') {
      this.next();
      return -this.unary();
    }
    return this.compound();
  }

  /** Quantities with units written side by side are added: 5' 3" = 5' + 3". */
  compound(): number {
    let { v, hasUnit } = this.postfix();
    while (hasUnit && this.peek()?.k === 'num') {
      const n = this.postfix();
      v += n.v;
      hasUnit = n.hasUnit;
    }
    return v;
  }

  postfix(): { v: number; hasUnit: boolean } {
    const v = this.primary();
    const p = this.peek();
    if (p?.k === 'unit') {
      this.next();
      return { v: TO_INCHES[p.v](v), hasUnit: true };
    }
    return { v, hasUnit: false };
  }

  primary(): number {
    const p = this.next();
    if (!p) throw new ParseError('eof');
    if (p.k === 'num') return literal(p.text);
    if (p.k === 'ans') return this.ans;
    if (p.k === 'lp') {
      const v = this.expr();
      const close = this.peek();
      if (close?.k === 'rp') this.next();
      else if (!(this.lenient && close === undefined)) throw new ParseError('paren');
      return v;
    }
    throw new ParseError('unexpected');
  }
}

/** Drop whatever can't be evaluated yet at the end (a dangling operator, `(`, `/`, `.`, space). */
function trimIncomplete(tokens: string[]): string[] {
  const t = [...tokens];
  const dangling = (x: string) => isOp(x) || x === '(' || x === '/' || x === '.' || x === ' ';
  while (t.length && dangling(t[t.length - 1])) t.pop();
  return t;
}

/** Evaluate in inches. Lenient mode auto-closes parens and ignores a trailing operator. */
export function evaluate(tokens: string[], ans: number, lenient = true): number | null {
  const t = lenient ? trimIncomplete(tokens) : tokens;
  if (t.length === 0) return null;
  try {
    const v = new Parser(lex(t), ans, lenient).run();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/* ---------- Key input rules ---------- */

export interface CalcState {
  tokens: string[];
  /** caret position: a token index from 0 to tokens.length */
  cursor: number;
  ans: number;
  /** true right after "=": a digit starts over, an operator continues from the answer */
  fresh: boolean;
  /** the expression that produced `ans`, shown faded above the display */
  history: string[] | null;
  historyAns: number;
}

export const emptyState = (): CalcState => ({ tokens: [], cursor: 0, ans: 0, fresh: false, history: null, historyAns: 0 });

function openParens(tokens: string[]) {
  let n = 0;
  for (const t of tokens) n += t === '(' ? 1 : t === ')' ? -1 : 0;
  return n;
}

/** The number literal right before the caret, if any. */
function currentNumber(tokens: string[]): string {
  let s = '';
  for (let i = tokens.length - 1; i >= 0 && isNumChar(tokens[i]); i--) s = tokens[i] + s;
  return s;
}

/** Ends with something that is a complete operand (can be followed by an operator). */
function endsWithOperand(tokens: string[]) {
  const last = tokens[tokens.length - 1];
  return isDigit(last) || isUnit(last) || last === ')' || last === 'ANS';
}

/**
 * Apply one key to the tokens before the caret. Mutates `t`; returns false
 * when the key makes no sense here and should be ignored.
 */
function applyKey(t: string[], key: string): boolean {
  const tail = t[t.length - 1];
  const cur = currentNumber(t);

  if (isDigit(key)) {
    if (tail === ')' || tail === 'ANS') t.push('×');
    // After feet, digits continue into the inches part: 5' 3".
    else if (isUnit(tail) && tail !== "'") return false;
    t.push(key);
    return true;
  }

  if (key === ' ') {
    // Starts the fraction of a mixed number: 1 → 1 1/32.
    if (!isDigit(tail) || /[ ./]/.test(cur)) return false;
    t.push(' ');
    return true;
  }

  if (key === '/') {
    if (!isDigit(tail) || /[./]/.test(cur)) return false;
    t.push('/');
    return true;
  }

  if (key === '.') {
    if (/[ ./]/.test(cur)) return false;
    if (tail === ')' || tail === 'ANS') t.push('×');
    else if (isUnit(tail) && tail !== "'") return false;
    if (!isDigit(t[t.length - 1])) t.push('0');
    t.push('.');
    return true;
  }

  if (isOp(key)) {
    if (t.length === 0 || tail === '(') {
      if (key !== '−') return false;
      t.push(key);
      return true;
    }
    if (isOp(tail)) {
      // 2 × −3: a minus after × or ÷ is a sign.
      if (key === '−' && (tail === '×' || tail === '÷')) {
        t.push(key);
        return true;
      }
      // Otherwise replace the operator, unless it's a sign.
      const before = t[t.length - 2];
      if (before === undefined || before === '(' || isOp(before)) return false;
      t[t.length - 1] = key;
      return true;
    }
    if (tail === '.' || tail === '/' || tail === ' ') return false;
    t.push(key);
    return true;
  }

  if (key === '()') {
    if (openParens(t) > 0 && endsWithOperand(t)) t.push(')');
    else {
      if (endsWithOperand(t)) t.push('×');
      t.push('(');
    }
    return true;
  }

  if (isUnit(key)) {
    if (isUnit(tail)) {
      t[t.length - 1] = key; // swap units: mm → cm
      return true;
    }
    if (!isDigit(tail) && tail !== ')') return false;
    t.push(key);
    return true;
  }

  return false;
}

export function press(state: CalcState, key: string): CalcState {
  if (key === 'AC') return emptyState();

  if (key === '⌫') {
    if (state.fresh) return { ...emptyState(), history: state.history, historyAns: state.historyAns };
    if (state.cursor === 0) return state;
    const tokens = [...state.tokens];
    tokens.splice(state.cursor - 1, 1);
    return { ...state, tokens, cursor: state.cursor - 1 };
  }

  if (key === '=') {
    const v = evaluate(state.tokens, state.ans, true);
    if (v === null || (state.tokens.length === 1 && state.tokens[0] === 'ANS')) return state;
    return { tokens: ['ANS'], cursor: 1, ans: v, fresh: true, history: [...state.tokens], historyAns: state.ans };
  }

  let tokens = state.tokens;
  let cursor = Math.min(state.cursor, tokens.length);
  // Starting a new number right after "=" replaces the answer.
  if (state.fresh && (isDigit(key) || key === '.' || key === '(' || key === '()')) {
    tokens = [];
    cursor = 0;
  }

  const before = tokens.slice(0, cursor);
  if (!applyKey(before, key)) return state;
  return { ...state, tokens: [...before, ...tokens.slice(cursor)], cursor: before.length, fresh: false };
}

/* ---------- Repeat / split ---------- */

export type SeriesMode = 'repeat' | 'split';

/**
 * Split the expression at its last top-level operator of the lowest precedence:
 * `1 + 1/32` → base `1`, step `+ 1/32`. Returns null when there is no binary operator.
 */
export function splitLastOperation(tokens: string[]): { base: string[]; op: Op; step: string[] } | null {
  const t = trimIncomplete(tokens);
  let depth = 0;
  let additive = -1;
  let multiplicative = -1;
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (tok === '(') depth++;
    else if (tok === ')') depth--;
    else if (depth === 0 && isOp(tok) && i > 0 && endsWithOperand(t.slice(0, i))) {
      if (tok === '+' || tok === '−') additive = i;
      else multiplicative = i;
    }
  }
  const at = additive >= 0 ? additive : multiplicative;
  if (at < 0) return null;
  return { base: t.slice(0, at), op: t[at] as Op, step: t.slice(at + 1) };
}

function apply(a: number, op: Op, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return a / b;
  }
}

/** Points for the series line, in inches. `count` ≥ 1. */
export function series(mode: SeriesMode, tokens: string[], ans: number, count: number): number[] | null {
  if (mode === 'split') {
    const total = evaluate(tokens, ans);
    if (total === null) return null;
    return Array.from({ length: count + 1 }, (_, k) => (total * k) / count);
  }
  const parts = splitLastOperation(tokens);
  let base: number | null;
  let op: Op = '+';
  let step: number | null;
  if (parts) {
    base = evaluate(parts.base, ans);
    step = evaluate(parts.step, ans);
    op = parts.op;
  } else {
    base = 0;
    step = evaluate(tokens, ans);
  }
  if (base === null || step === null || (op === '÷' && step === 0)) return null;
  const out = [base];
  for (let k = 0; k < count; k++) out.push(apply(out[out.length - 1], op, step));
  return out;
}
