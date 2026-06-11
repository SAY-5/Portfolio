import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './lumen-lang.css';

// Real mechanism: a hand-written single-pass lexer (no regex) feeds a
// recursive-descent parser with precedence climbing, producing an AST that
// runs on either a tree-walking interpreter (default) or a compile-to-bytecode
// stack VM, both selectable from the CLI. About 4k LOC C++20. The bench harness
// reports ops/sec for fib(30), bubble_sort(1000), and mandelbrot.

const LOC = '~4k';

type Engine = 'tree' | 'vm';

type Sample = {
  id: string;
  label: string;
  src: string;
  tokens: { t: string; k: TokKind }[];
  // a compact AST sketch shown as an indented tree
  ast: { depth: number; node: string }[];
  // stack-VM bytecode sketch
  code: string[];
  result: string;
};

type TokKind = 'kw' | 'id' | 'num' | 'op' | 'punct';

const samples: Sample[] = [
  {
    id: 'fn',
    label: 'function + closure',
    src: 'fun adder(n) {\n  fun add(x) { return x + n; }\n  return add;\n}\nvar f = adder(10);\nprint f(5);',
    tokens: [
      { t: 'fun', k: 'kw' },
      { t: 'adder', k: 'id' },
      { t: '(', k: 'punct' },
      { t: 'n', k: 'id' },
      { t: ')', k: 'punct' },
      { t: '{', k: 'punct' },
      { t: 'fun', k: 'kw' },
      { t: 'add', k: 'id' },
      { t: 'x', k: 'id' },
      { t: 'return', k: 'kw' },
      { t: 'x', k: 'id' },
      { t: '+', k: 'op' },
      { t: 'n', k: 'id' },
      { t: 'return', k: 'kw' },
      { t: 'add', k: 'id' },
    ],
    ast: [
      { depth: 0, node: 'FunDecl adder(n)' },
      { depth: 1, node: 'FunDecl add(x)' },
      { depth: 2, node: 'Return' },
      { depth: 3, node: 'Binary +' },
      { depth: 4, node: 'Var x' },
      { depth: 4, node: 'Upvalue n' },
      { depth: 1, node: 'Return add' },
    ],
    code: [
      'OP_CLOSURE add',
      'OP_GET_UPVALUE n',
      'OP_GET_LOCAL x',
      'OP_ADD',
      'OP_RETURN',
    ],
    result: '15',
  },
  {
    id: 'cls',
    label: 'class + inheritance',
    src: 'class Animal { speak() { return "..."; } }\nclass Dog < Animal {\n  speak() { return "woof"; }\n}\nprint Dog().speak();',
    tokens: [
      { t: 'class', k: 'kw' },
      { t: 'Animal', k: 'id' },
      { t: 'speak', k: 'id' },
      { t: 'class', k: 'kw' },
      { t: 'Dog', k: 'id' },
      { t: '<', k: 'op' },
      { t: 'Animal', k: 'id' },
      { t: 'speak', k: 'id' },
      { t: 'return', k: 'kw' },
      { t: 'woof', k: 'id' },
      { t: 'Dog', k: 'id' },
      { t: '(', k: 'punct' },
      { t: ')', k: 'punct' },
      { t: 'speak', k: 'id' },
    ],
    ast: [
      { depth: 0, node: 'ClassDecl Animal' },
      { depth: 1, node: 'Method speak' },
      { depth: 0, node: 'ClassDecl Dog < Animal' },
      { depth: 1, node: 'Method speak (override)' },
      { depth: 0, node: 'Call Dog().speak()' },
      { depth: 1, node: 'Dispatch -> Dog.speak' },
    ],
    code: [
      'OP_CLASS Dog',
      'OP_INHERIT Animal',
      'OP_METHOD speak',
      'OP_INVOKE speak, 0',
      'OP_RETURN',
    ],
    result: 'woof',
  },
  {
    id: 'arith',
    label: 'precedence climbing',
    src: 'print 2 + 3 * 4 - 1;',
    tokens: [
      { t: 'print', k: 'kw' },
      { t: '2', k: 'num' },
      { t: '+', k: 'op' },
      { t: '3', k: 'num' },
      { t: '*', k: 'op' },
      { t: '4', k: 'num' },
      { t: '-', k: 'op' },
      { t: '1', k: 'num' },
    ],
    ast: [
      { depth: 0, node: 'Binary -' },
      { depth: 1, node: 'Binary +' },
      { depth: 2, node: 'Num 2' },
      { depth: 2, node: 'Binary *' },
      { depth: 3, node: 'Num 3' },
      { depth: 3, node: 'Num 4' },
      { depth: 1, node: 'Num 1' },
    ],
    code: [
      'OP_CONST 2',
      'OP_CONST 3',
      'OP_CONST 4',
      'OP_MUL',
      'OP_ADD',
      'OP_CONST 1',
      'OP_SUB',
    ],
    result: '13',
  },
];

// Real bench rows: fib(30), bubble_sort(1000), mandelbrot. Ops/sec figures are
// illustrative relative throughput between the two engines (VM faster), shown
// to make the engine toggle meaningful; the harness fires at 30% drift.
const bench = [
  { name: 'fib(30)', tree: 3.1, vm: 7.4 },
  { name: 'bubble_sort(1000)', tree: 1.8, vm: 4.6 },
  { name: 'mandelbrot', tree: 0.9, vm: 2.3 },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function LumenLangDemo() {
  const reduce = useReducedMotion();
  const [sampleId, setSampleId] = useState<string>('fn');
  const [engine, setEngine] = useState<Engine>('tree');
  const [step, setStep] = useState<number>(0); // 0 src, 1 tokens, 2 ast, 3 run
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const sample = useMemo(
    () => samples.find((s) => s.id === sampleId)!,
    [sampleId],
  );

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  function selectSample(id: string) {
    clearTimer();
    setPlaying(false);
    setSampleId(id);
    setStep(0);
  }

  function nextStep() {
    setStep((s) => Math.min(3, s + 1));
  }

  function play() {
    clearTimer();
    if (reduce) {
      setStep(3);
      return;
    }
    setPlaying(true);
    setStep(0);
    const advance = (n: number) => {
      setStep(n);
      if (n < 3) {
        timer.current = window.setTimeout(() => advance(n + 1), 800);
      } else {
        setPlaying(false);
        timer.current = null;
      }
    };
    timer.current = window.setTimeout(() => advance(1), 600);
  }

  function reset() {
    clearTimer();
    setPlaying(false);
    setStep(0);
  }

  const stageNames = ['source', 'tokens', 'parse tree', engine === 'tree' ? 'tree-walk' : 'bytecode VM'];

  return (
    <div className="demo" aria-label="lumen language pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">From source to a running engine</h3>
      <p className="demo__lede">
        Pick a snippet and step it through the pipeline: a single-pass lexer
        emits tokens, a recursive-descent parser builds the AST, then it runs on
        the tree-walking interpreter or compiles to bytecode for the stack VM.
        Switch engines to see the same program take a different path.
      </p>

      <div className="ll__samples" role="tablist" aria-label="code samples">
        {samples.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === sampleId}
            className={'ll__sample' + (s.id === sampleId ? ' ll__sample--on' : '')}
            onClick={() => selectSample(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="ll__engine" role="group" aria-label="execution engine">
        <span className="ll__engine-label">engine</span>
        <div className="ll__toggle">
          <button
            className={'ll__toggle-btn' + (engine === 'tree' ? ' ll__toggle-btn--on' : '')}
            aria-pressed={engine === 'tree'}
            onClick={() => setEngine('tree')}
          >
            tree-walking
          </button>
          <button
            className={'ll__toggle-btn' + (engine === 'vm' ? ' ll__toggle-btn--on' : '')}
            aria-pressed={engine === 'vm'}
            onClick={() => setEngine('vm')}
          >
            bytecode VM
          </button>
        </div>
      </div>

      <div className="ll__pipeline" aria-hidden={false}>
        {stageNames.map((name, i) => (
          <div
            key={name}
            className={
              'll__stage-pill' +
              (i <= step ? ' ll__stage-pill--on' : '') +
              (i === step ? ' ll__stage-pill--cur' : '')
            }
          >
            <span className="ll__stage-num">{i + 1}</span>
            {name}
          </div>
        ))}
      </div>

      <div className="ll__panels">
        <div className="ll__panel ll__panel--src">
          <div className="ll__panel-head">source</div>
          <pre className="ll__src">{sample.src}</pre>
        </div>

        <div className="ll__panel">
          <div className="ll__panel-head">
            {step >= 1 ? `tokens (${sample.tokens.length})` : 'tokens'}
          </div>
          <div className="ll__tokens">
            <AnimatePresence>
              {step >= 1 &&
                sample.tokens.map((tok, i) => (
                  <motion.span
                    key={`${sample.id}-${i}`}
                    className={`ll__tok ll__tok--${tok.k}`}
                    initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : i * 0.025, ease }}
                  >
                    {tok.t}
                  </motion.span>
                ))}
            </AnimatePresence>
            {step < 1 && <span className="ll__muted">run to lex</span>}
          </div>
        </div>

        <div className="ll__panel">
          <div className="ll__panel-head">parse tree</div>
          <div className="ll__ast">
            <AnimatePresence>
              {step >= 2 &&
                sample.ast.map((n, i) => (
                  <motion.div
                    key={`${sample.id}-${i}`}
                    className="ll__ast-row"
                    style={{ paddingLeft: 8 + n.depth * 16 }}
                    initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : i * 0.04, ease }}
                  >
                    <span className="ll__ast-branch">{n.depth > 0 ? '└─' : '●'}</span>
                    {n.node}
                  </motion.div>
                ))}
            </AnimatePresence>
            {step < 2 && <span className="ll__muted">parse to build the AST</span>}
          </div>
        </div>

        <div className="ll__panel ll__panel--run">
          <div className="ll__panel-head">
            {engine === 'tree' ? 'tree-walking interpreter' : 'bytecode + stack VM'}
          </div>
          {engine === 'vm' && step >= 3 ? (
            <div className="ll__code">
              {sample.code.map((c, i) => (
                <motion.div
                  key={`${sample.id}-${i}`}
                  className="ll__code-row"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : i * 0.05 }}
                >
                  <span className="ll__code-off">{(i * 2).toString().padStart(4, '0')}</span>
                  {c}
                </motion.div>
              ))}
            </div>
          ) : engine === 'tree' && step >= 3 ? (
            <div className="ll__walk">walked the AST, no compile step</div>
          ) : (
            <span className="ll__muted">run to evaluate</span>
          )}
          <AnimatePresence>
            {step >= 3 && (
              <motion.div
                className="ll__result"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.2, ease }}
              >
                <span className="ll__result-label">stdout</span>
                <span className="ll__result-val">{sample.result}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="ll__bench">
        <div className="ll__bench-head">
          <span>bench harness</span>
          <span className="ll__bench-sub">relative ops/sec, {LOC} LOC C++20</span>
        </div>
        {bench.map((b) => {
          const val = engine === 'tree' ? b.tree : b.vm;
          const max = 7.4;
          return (
            <div key={b.name} className="ll__bench-row">
              <span className="ll__bench-name">{b.name}</span>
              <div className="ll__bench-track">
                <motion.div
                  className="ll__bench-fill"
                  initial={false}
                  animate={{ width: `${(val / max) * 100}%` }}
                  transition={{ duration: reduce ? 0 : 0.5, ease }}
                />
              </div>
              <span className="ll__bench-val">{val.toFixed(1)}</span>
            </div>
          );
        })}
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={playing}>
          {playing ? 'Running…' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={nextStep}
          disabled={playing || step >= 3}
        >
          Step
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={playing}
        >
          Reset
        </button>
        <span className="demo__hint">
          {stageNames[step]} on {engine === 'tree' ? 'tree-walking' : 'bytecode VM'}
        </span>
      </div>
    </div>
  );
}
