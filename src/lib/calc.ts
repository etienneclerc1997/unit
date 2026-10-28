// Calculator engine. The expression is a flat list of key tokens so backspace
// removes exactly what one key press added. Every value is computed in inches;
// numbers typed without a unit are inches.

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
const isNumChar = (t: string | undefined) => isDigit(t) || t === '.' || t === '/';
export const isOp = (t: string | undefined): t is Op => t !== undefined && OPS.has(t);
export const isUnit = (t: string | undefined): t is Unit => t !== undefined && UNITS.has(t);

/* ---------- Lexing ---------- */

export type Item =
  | { k: 'num'; text: string }
  | { k: 'ans' }
  | { k: 'op'; v: Op }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'unit'; v: Unit };

export function lex(tokens: string[]): Item[] {
  const items: Item[] = [];
  for (const t of tokens) {
    const last = items[items.length - 1];
    if (isNumChar(t)) {
      if (last?.k === 'num') last.text += t;
      else items.push({ k: 'num', text: t });
    } else if (t === 'ANS') items.push({ k: 'ans' });
    else if (isOp(t)) items.push({ k: 'op', v: t });
    else if (t === '(') items.push({ k: 'lp' });
    else if (t === ')') items.push({ k: 'rp' });
    else if (isUnit(t)) items.push({ k: 'unit', v: t });
  }
  return items;
}

/* ---------- Parsing ---------- */

class ParseError extends Error {}

function literal(text: string): number {
  const parts = text.split('/');
  if (parts.length > 2 || parts.some((p) => p === '' || p === '.')) throw new ParseError(text);
  const [a, b] = parts.map(Number);
  if (Number.isNaN(a) || (b !== undefined && Number.isNaN(b))) throw new ParseError(text);
  if (b === 0) throw new ParseError('div0');
  return b === undefined ? a : a / b;
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

/** Drop whatever can't be evaluated yet at the end (a dangling operator, `(`, `/`, `.`). */
function trimIncomplete(tokens: string[]): string[] {
  const t = [...tokens];
  while (t.length && (isOp(t[t.length - 1]) || t[t.length - 1] === '(' || t[t.length - 1] === '/' || t[t.length - 1] === '.')) {
    t.pop();
  }
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
  ans: number;
  /** true right after "=": a digit starts over, an operator continues from the answer */
  fresh: boolean;
  /** the expression that produced `ans`, shown faded above the display */
  history: string[] | null;
  historyAns: number;
}

export const emptyState = (): CalcState => ({ tokens: [], ans: 0, fresh: false, history: null, historyAns: 0 });

function openParens(tokens: string[]) {
  let n = 0;
  for (const t of tokens) n += t === '(' ? 1 : t === ')' ? -1 : 0;
  return n;
}

/** The number literal currently being typed at the end, if any. */
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

export function press(state: CalcState, key: string): CalcState {
  const s: CalcState = { ...state, tokens: [...state.tokens] };
  const t = s.tokens;
  const last = t[t.length - 1];

  if (key === 'AC') return emptyState();

  if (key === '⌫') {
    if (s.fresh) return { ...emptyState(), history: s.history, historyAns: s.historyAns };
    t.pop();
    return s;
  }

  if (key === '=') {
    const v = evaluate(t, s.ans, true);
    if (v === null || (t.length === 1 && t[0] === 'ANS')) return s;
    return { tokens: ['ANS'], ans: v, fresh: true, history: [...t], historyAns: s.ans };
  }

  // Starting a new number right after "=" replaces the answer.
  if (s.fresh && (isDigit(key) || key === '.' || key === '(')) {
    t.length = 0;
  }
  s.fresh = false;
  const tail = t[t.length - 1];

  if (isDigit(key)) {
    if (tail === ')' || tail === 'ANS') t.push('×');
    t.push(key);
    return s;
  }

  if (key === '.') {
    const cur = currentNumber(t);
    const part = cur.split('/').pop() ?? '';
    if (part.includes('.')) return state;
    if (tail === ')' || tail === 'ANS') t.push('×');
    if (!isDigit(t[t.length - 1])) t.push('0');
    t.push('.');
    return s;
  }

  if (key === '/') {
    const cur = currentNumber(t);
    if (!isDigit(tail) || cur.includes('/')) return state;
    t.push('/');
    return s;
  }

  if (isOp(key)) {
    if (t.length === 0 || tail === '(') {
      if (key === '−') t.push(key);
      return s;
    }
    if (isOp(tail)) {
      // 2 × −3: a minus after × or ÷ is a sign.
      if (key === '−' && (tail === '×' || tail === '÷')) {
        t.push(key);
        return s;
      }
      // Otherwise replace the operator, unless it's a sign.
      const before = t[t.length - 2];
      if (before === undefined || before === '(' || isOp(before)) return state;
      t[t.length - 1] = key;
      return s;
    }
    if (tail === '.' || tail === '/') return state;
    t.push(key);
    return s;
  }

  if (key === '()') {
    if (openParens(t) > 0 && endsWithOperand(t)) t.push(')');
    else {
      if (endsWithOperand(t)) t.push('×');
      t.push('(');
    }
    return s;
  }

  if (isUnit(key)) {
    if (isUnit(tail)) {
      t[t.length - 1] = key; // swap units: mm → cm
      return s;
    }
    if (isDigit(tail) || tail === ')') {
      t.push(key);
      return s;
    }
    return state;
  }

  return state;
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
