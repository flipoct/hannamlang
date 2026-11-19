// 한남랭 (HannamLang) — 파서 + 인터프리터 + 문장→코드 생성기.
// 브라우저(window.JweJwe)와 node(require) 양쪽에서 쓴다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HannamLang = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 물결은 반각/전각/파도 모두 같은 걸로 친다
  const norm = (s) => s.replace(/[~～〜∼]/g, '~');

  function countDots(s) {
    let n = 0;
    for (const ch of s) n += ch === '…' ? 3 : ch === '‥' ? 2 : 1;
    return n;
  }

  function classify(t) {
    const s = norm(t.text);
    let m;
    if ((m = /^엄([.．。…‥]*)$/.exec(s))) {
      const n = countDots(m[1]);
      if (n === 0) return { ...t, type: 'bad', msg: '엄 뒤에 마침표를 붙여서 변수 번호를 정해야 함 (엄. = 1번)' };
      return { ...t, type: 'sel', n };
    }
    if (/^(아뇨)+$/.test(s)) return { ...t, type: 'loop', n: s.length / 2 };
    // '아'는 아무 뜻 없는 꾸밈. 따로 써도(아 줴줴이야) 붙여 써도(아줴줴이야) 빼도(줴줴이야) 됨
    if (/^아+[~!.…]*$/.test(s)) return { ...t, type: 'deco' };
    if (/^아*줴줴이야$/.test(s)) return { ...t, type: 'end' };
    if (/^아*예[?？]$/.test(s)) return { ...t, type: 'in' };
    if ((m = /^요(~*)이(~*)$/.exec(s))) return addSub(t, 'add', m);
    if ((m = /^[쥐지](~*)랄(~*)$/.exec(s))) return addSub(t, 'sub', m); // 쥐랄 = 지랄
    if (/^티~*원$/.test(s)) return { ...t, type: 'outc' };
    if (/^[Tt]~*1$/.test(s)) return { ...t, type: 'outn' };
    return { ...t, type: 'nop' };
  }

  // 가운데 물결 n개 = n번 변수만큼, 뒤 물결 k개 = 상수 k만큼, 둘 다 있으면 합 (둘 다 없으면 1)
  function addSub(t, type, m) {
    const n = m[1].length, k = m[2].length;
    return { ...t, type, n, k: n ? k : Math.max(k, 1) };
  }

  function tokenize(src) {
    const toks = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(src))) toks.push(classify({ text: m[0], start: m.index, end: m.index + m[0].length }));
    return toks;
  }

  function lineCol(src, pos) {
    const before = src.slice(0, pos);
    const line = before.split('\n').length;
    return { line, col: pos - before.lastIndexOf('\n') };
  }

  function parse(src) {
    const tokens = tokenize(src);
    const errors = [];
    const ops = [];
    const stack = [];
    tokens.forEach((t, ti) => {
      t.ti = ti;
      if (t.type === 'bad') { errors.push({ tok: t, msg: t.msg }); return; }
      if (t.type === 'nop' || t.type === 'deco') return;
      t.oi = ops.length;
      ops.push(t);
      if (t.type === 'loop') stack.push(t);
      else if (t.type === 'end') {
        const open = stack.pop();
        if (!open) errors.push({ tok: t, msg: '짝이 맞는 아뇨가 없는 줴줴이야' });
        else { open.match = t.oi; t.match = open.oi; }
      }
    });
    for (const t of stack) errors.push({ tok: t, msg: '줴줴이야로 닫히지 않은 반복문' });
    for (const e of errors) Object.assign(e, lineCol(src, e.tok.start));
    errors.sort((a, b) => a.tok.start - b.tok.start);
    let maxVar = 1;
    for (const o of ops) if (o.n) maxVar = Math.max(maxVar, o.n);
    return { src, tokens, ops, errors, maxVar };
  }

  class RunError extends Error {
    constructor(msg, op) { super(msg); this.op = op; }
  }

  // io.readNum(): number | undefined(아직 입력 없음) / io.write(str)
  class Machine {
    constructor(prog, io) {
      if (prog.errors.length) throw new Error('문법 오류가 있는 프로그램은 실행할 수 없음');
      this.prog = prog;
      this.ops = prog.ops;
      this.io = io;
      this.vars = new Map();
      this.cur = 1;
      this.pc = 0;
      this.steps = 0;
      this.maxVar = prog.maxVar;
    }
    get(n) { return this.vars.get(n) || 0; }
    set(n, v) {
      if (!Number.isSafeInteger(v)) throw new RunError(`${n}번 변수가 너무 커짐 (${v})`, this.ops[this.pc]);
      this.vars.set(n, v);
    }
    get done() { return this.pc >= this.ops.length; }
    // 'ok' | 'halt' | 'input'
    step() {
      if (this.pc >= this.ops.length) return 'halt';
      const op = this.ops[this.pc];
      switch (op.type) {
        case 'sel':
          this.cur = op.n;
          if (op.n > this.maxVar) this.maxVar = op.n;
          break;
        case 'loop':
          if (this.get(op.n) === 0) { this.pc = op.match + 1; this.steps++; return this.pc >= this.ops.length ? 'halt' : 'ok'; }
          break;
        case 'end':
          this.pc = op.match; this.steps++;
          return 'ok';
        case 'in': {
          const v = this.io.readNum();
          if (v === undefined) return 'input';
          this.set(this.cur, v);
          break;
        }
        case 'add': this.set(this.cur, this.get(this.cur) + (op.n ? this.get(op.n) : 0) + op.k); break;
        case 'sub': this.set(this.cur, this.get(this.cur) - (op.n ? this.get(op.n) : 0) - op.k); break;
        case 'outc': {
          const v = this.get(this.cur);
          if (v < 0 || v > 0x10ffff) throw new RunError(`문자로 출력할 수 없는 값: ${v}`, op);
          this.io.write(String.fromCodePoint(v));
          break;
        }
        case 'outn': this.io.write(String(this.get(this.cur))); break;
      }
      this.pc++;
      this.steps++;
      return this.pc >= this.ops.length ? 'halt' : 'ok';
    }
  }

  // 한 번에 끝까지 돌리는 헬퍼 (node 테스트용). inputs: 숫자 배열
  function run(src, inputs = [], maxSteps = 5e7) {
    const prog = parse(src);
    if (prog.errors.length) return { errors: prog.errors, out: '' };
    let out = '';
    const q = inputs.slice();
    const m = new Machine(prog, { readNum: () => q.shift(), write: (s) => { out += s; } });
    let st = 'ok';
    while (st === 'ok' && m.steps < maxSteps) st = m.step();
    return { out, status: st, steps: m.steps, vars: m.vars };
  }

  // ---- 문장 → 코드 ----
  // 1번 변수에 글자 코드를 만들어 티~원. 차이가 크면 2번(횟수)×3번(배수) 곱셈 반복, 나머지는 뒤 물결 상수로.
  const konst = (up, k) => (up ? '요이' : '쥐랄') + (k > 1 ? '~'.repeat(k) : '');

  function generate(text, { comments = true } = {}) {
    const lines = [];
    let v = 0; // 1번 변수 현재값
    let f3 = 0; // 3번 변수 현재값
    for (const ch of text) {
      const c = ch.codePointAt(0);
      const d = c - v;
      const a = Math.abs(d);
      const up = d >= 0;
      const words = [];
      if (comments) words.push('「' + (ch === '\n' ? '⏎' : ch === ' ' ? '␣' : ch) + '」');
      // 글자 수 기준으로 직접 상수 vs 곱셈 비교
      // 100 이하는 루프 없이 상수 한 개로
      let best = { cost: a + 6, f: 0 };
      for (let f = 2; a > 100 && f * 2 <= a && f <= 5000; f++) {
        const q = Math.floor(a / f), r = a - q * f;
        const setup = f === f3 ? 0 : 5 + (f3 ? 6 : 0) + f + 3;
        const cost = setup + 4 + q + 3 + 36 + (r ? r + 3 : 0);
        if (cost < best.cost) best = { cost, f, q, r };
      }
      if (best.f) {
        const { f, q, r } = best;
        if (f !== f3) {
          words.push('엄...');
          if (f3) words.push('쥐~~~랄');
          words.push(konst(true, f));
          f3 = f;
        }
        words.push('엄..', konst(true, q), '아뇨아뇨', '엄.', up ? '요~~~이' : '쥐~~~랄', '엄..', '쥐랄', '아 줴줴이야', '엄.');
        if (r) words.push(konst(up, r));
      } else if (a) {
        words.push(konst(up, a)); // 곱셈 분기도 엄.으로 끝나니 여기선 늘 1번 변수
      }
      words.push('티~원');
      v = c;
      lines.push(words.join(' '));
    }
    return lines.join('\n');
  }

  // 같은 줄에 붙어 있는 상수 요이/쥐랄 묶음을 하나로: "요이 요이 쥐랄 요이~~" → "요이~~~"
  function compress(src) {
    const toks = tokenize(src);
    const isConst = (t) => (t.type === 'add' || t.type === 'sub') && !t.n;
    let out = '', last = 0, i = 0;
    while (i < toks.length) {
      if (!isConst(toks[i])) { i++; continue; }
      let j = i + 1, sum = toks[i].type === 'add' ? toks[i].k : -toks[i].k;
      while (j < toks.length && isConst(toks[j]) && /^[ \t]*$/.test(src.slice(toks[j - 1].end, toks[j].start))) {
        sum += toks[j].type === 'add' ? toks[j].k : -toks[j].k;
        j++;
      }
      if (j - i > 1) {
        out += src.slice(last, toks[i].start) + (sum ? konst(sum > 0, Math.abs(sum)) : '');
        last = toks[j - 1].end;
      }
      i = j;
    }
    return out + src.slice(last);
  }

  return { tokenize, parse, Machine, RunError, run, generate, compress, lineCol };
});
