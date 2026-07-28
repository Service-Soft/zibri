import { describe, expect, it } from '@jest/globals';

import { ArrowFunctionExpression, Expression, ImportDeclaration,
    JSXElement, JSXExpressionContainer, Program, Statement, TemplateLiteral, VariableDeclaration } from './ast';
import { parse } from './parser';
import { parseError, parseExpression, parseOk, parseStatement } from '../__testing__/parse.helper';
import { tokenTuples } from '../__testing__/tokenize.helper';

describe('Parser', () => {
    describe('imports', () => {
        it('parses named, default, namespace and client imports', () => {
            const program: Program = parseOk([
                'import { a, b as c } from \'mod\';',
                'import Def from \'def\';',
                'import * as ns from \'ns\';',
                'import { Chart } from \'chart.js?client\';',
                'import type { T } from \'types\';'
            ].join('\n'));

            const [named, def, ns, client, typeOnly] = program.body as ImportDeclaration[];
            expect(named).toMatchObject({ source: 'mod', specifiers: [{ imported: 'a', local: 'a' }, { imported: 'b', local: 'c' }] });
            expect(def).toMatchObject({ defaultImport: 'Def', source: 'def' });
            expect(ns).toMatchObject({ namespaceImport: 'ns' });
            expect(client).toMatchObject({ source: 'chart.js', client: true });
            expect(typeOnly).toMatchObject({ typeOnly: true });
        });
    });

    describe('type erasure', () => {
        it('erases annotations on variable declarations', () => {
            const decl: VariableDeclaration = parseStatement('const x: number = 1;') as VariableDeclaration;
            expect(decl.declarations[0]).toMatchObject({ id: { name: 'x' }, init: { kind: 'NumericLiteral', raw: '1' } });
        });

        it('erases the TsxComponent typed arrow form used by templates', () => {
            const decl: VariableDeclaration = parseStatement('const Page: TsxComponent<Props> = ({ title }) => title;') as VariableDeclaration;
            expect(decl.declarations[0].init?.kind).toBe('ArrowFunctionExpression');
        });

        it('erases as/satisfies casts', () => {
            expect(parseExpression('x as string').kind).toBe('Identifier');
            expect(parseExpression('x satisfies Foo').kind).toBe('Identifier');
            expect(parseExpression('x as const').kind).toBe('Identifier');
        });

        it('erases non-null assertions', () => {
            const call: Expression = parseExpression('document.querySelector(\'#a\')!');
            expect(call.kind).toBe('CallExpression');
        });

        it('erases generic type arguments on calls and new', () => {
            expect(parseExpression('foo<Bar>(1)').kind).toBe('CallExpression');
            expect(parseExpression('new Chart<any, any>(canvas, config)').kind).toBe('NewExpression');
        });

        it('erases only a return type', () => {
            parseOk('function f(): void { const x = 1; }');
        });

        it('erases only a param type (no return type)', () => {
            parseOk('function f(a: T) { const x = 1; }');
        });

        it('erases a function param array-type and return type', () => {
            parseOk('function f(a: T[]): void { const x = 1; }');
        });

        it('erases a var type inside a typed function', () => {
            parseOk('function f(a: T[]): void { const y: number = g(); }');
        });

        it('erases types around a chained-arrow initializer inside a typed function', () => {
            parseOk('function f(a: T[]): void { const y: number = a.filter(m => m.n).reduce((p, c) => p, 0); }');
        });

        it('erases top-level type and interface declarations', () => {
            const program: Program = parseOk('type A = { a: number };\ninterface B { b: string }\nconst x = 1;');
            expect(program.body).toHaveLength(1);
            expect(program.body[0].kind).toBe('VariableDeclaration');
        });
    });

    describe('expressions', () => {
        it('respects operator precedence', () => {
            const expr: Expression = parseExpression('1 + 2 * 3');
            expect(expr.kind).toBe('BinaryExpression');
            expect((expr as { operator: string }).operator).toBe('+');
        });

        it('parses logical and nullish operators', () => {
            expect(parseExpression('a && b || c').kind).toBe('LogicalExpression');
            expect(parseExpression('a ?? b').kind).toBe('LogicalExpression');
        });

        it('parses optional chaining and calls', () => {
            const expr: Expression = parseExpression('a?.b?.(c)?.[d]');
            expect(expr.kind).toBe('MemberExpression');
        });

        it('parses ternaries', () => {
            const expr: Expression = parseExpression('a ? b : c');
            expect(expr.kind).toBe('ConditionalExpression');
        });

        it('parses arrow functions with destructured params and defaults', () => {
            const arrow: ArrowFunctionExpression = parseExpression('({ a, b = 1, c: d }) => a + b + d') as ArrowFunctionExpression;
            expect(arrow.kind).toBe('ArrowFunctionExpression');
            expect(arrow.params[0].kind).toBe('ObjectPattern');
        });

        it('distinguishes a parenthesized expression from an arrow', () => {
            expect(parseExpression('(a + b)').kind).toBe('ParenthesizedExpression');
            expect(parseExpression('(a) => a').kind).toBe('ArrowFunctionExpression');
        });
    });

    describe('template literals', () => {
        it('parses quasis and interpolations', () => {
            const tpl: TemplateLiteral = parseExpression('`a${x}b${y}c`') as TemplateLiteral;
            expect(tpl.quasis).toEqual(['a', 'b', 'c']);
            expect(tpl.expressions).toHaveLength(2);
        });

        it('parses tagged templates like $t`...`', () => {
            const tagged: Expression = parseExpression('$t`hello ${name}`');
            expect(tagged.kind).toBe('TaggedTemplateExpression');
        });

        it('handles nested template literals', () => {
            const tpl: TemplateLiteral = parseExpression('`a${ `b${c}` }d`') as TemplateLiteral;
            expect(tpl.quasis).toEqual(['a', 'd']);
        });
    });

    describe('jsx', () => {
        it('parses a simple element with attributes', () => {
            const el: JSXElement = parseExpression('<div id="x" className={cls}>hi</div>') as JSXElement;
            expect(el.kind).toBe('JSXElement');
            expect(el.attributes).toHaveLength(2);
            expect(el.children[0]).toMatchObject({ kind: 'JSXText', value: 'hi' });
        });

        it('parses self-closing elements', () => {
            const el: JSXElement = parseExpression('<img src="a.png" />') as JSXElement;
            expect(el.selfClosing).toBe(true);
        });

        it('parses fragments', () => {
            const frag: Expression = parseExpression('(<><A/><B/></>)');
            expect(frag.kind).toBe('ParenthesizedExpression');
        });

        it('parses member-name components and spread attributes', () => {
            const el: JSXElement = parseExpression('<Ns.Comp {...props} a={1} />') as JSXElement;
            expect(el.name.kind).toBe('JSXMemberName');
            expect(el.attributes[0].kind).toBe('JSXSpreadAttribute');
        });

        it('parses hyphenated attribute names', () => {
            const el: JSXElement = parseExpression('<div data-ssr-handlers="h1:click" aria-label="x" />') as JSXElement;
            const names: string[] = el.attributes.map(a => a.kind === 'JSXAttribute' ? a.name : '...');
            expect(names).toEqual(['data-ssr-handlers', 'aria-label']);
        });

        it('parses boolean attributes', () => {
            const el: JSXElement = parseExpression('<input disabled />') as JSXElement;
            expect(el.attributes[0]).toMatchObject({ kind: 'JSXAttribute', name: 'disabled', value: undefined });
        });

        it('handles division and regex inside attribute expressions', () => {
            const el: JSXElement = parseExpression('<div data-x={a / b} data-y={s.replace(/x/g, \'\')} />') as JSXElement;
            expect(el.attributes).toHaveLength(2);
        });
    });

    describe('strange nesting (the cases the old solution had to special-case)', () => {
        it('parses JSX in .map inside a child expression container', () => {
            const el: JSXElement = parseExpression('<div>{items.map(i => <li>{i}</li>)}</div>') as JSXElement;
            const container: JSXExpressionContainer = el.children.find(c => c.kind === 'JSXExpressionContainer') as JSXExpressionContainer;
            expect(container.expression?.kind).toBe('CallExpression');
        });

        it('parses a map returning a component with a handler and template attribute', () => {
            parseOk('const x = (<div>{tabs.map(tab => <button id={`b-${tab.id}`} onClick={() => f(tab.id)}>{tab.label}</button>)}</div>);');
        });

        it('parses JSX inside ternary inside logical-and inside a container', () => {
            parseOk('const x = <div>{ok && (cond ? <A/> : <B/>)}</div>;');
        });

        it('parses deeply nested components as children', () => {
            parseOk('const x = <Card><Heading>{title}</Heading><List>{xs.map(x => <Item key={x.id}>{x.name}</Item>)}</List></Card>;');
        });

        it('parses a container followed by more children', () => {
            const el: JSXElement = parseExpression('<div>{items.map(i => <li>{i}</li>)}{other}tail</div>') as JSXElement;
            expect(el.children.filter(c => c.kind === 'JSXExpressionContainer')).toHaveLength(2);
        });

        it('parses the exact multiline map/button shape from tab-bar', () => {
            parseOk([
                'const x = (',
                '  <div className={className}>',
                '    <div className="flex">',
                '      {tabs.map(tab => <button',
                '        id={`button-${tab.id}`}',
                '        className={\'px-4 py-1 border-b-2 hover:border-secondary\'}',
                '        onClick={() => changeTab(tab.id)}',
                '      >',
                '        {tab.label}',
                '      </button>)}',
                '    </div>',
                '  </div>',
                ');'
            ].join('\n'));
        });

        it('parses the metrics onClient event-listener block', () => {
            parseOk([
                'onClient(() => {',
                '  document.addEventListener(\'metrics:update\', (ev) => {',
                '    if (!(ev instanceof CustomEvent) || !(\'snaps\' in ev.detail)) {',
                '      throw new Error($ts`received invalid metrics event`);',
                '    }',
                '    update((ev as MetricsEvent).detail.snaps);',
                '  });',
                '});'
            ].join('\n'));
        });

        it('min: arrow-block with a nested single arrow', () => {
            parseOk('const C = () => { g(a => a); };');
        });

        it('min: arrow-block with chained nested arrows', () => {
            parseOk('const C = () => { g(a => a).reduce((p, c) => p, 0); };');
        });

        it('min: two-param arrow inside an arrow-block', () => {
            parseOk('const C = () => { h((p, c) => p + c, 0); };');
        });

        it('produces identical tokens for multiline and flattened source', () => {
            const multi: string = 'const Card = ({ className }) => {\n  function update(snaps) {\n    const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);\n  }\n  return <div />;\n};';
            const flat: string = multi.replaceAll(/\n\s*/g, ' ');
            expect(tokenTuples(multi)).toEqual(tokenTuples(flat));
        });

        it('parses identically regardless of source whitespace', () => {
            const multi: string = 'const Card = ({ className }) => {\n  function update(snaps) {\n    const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);\n  }\n  return <div />;\n};';
            const flat: string = multi.replaceAll(/\n\s*/g, ' ');
            expect(parse(multi).diagnostics).toEqual([]);
            expect(parse(flat).diagnostics).toEqual([]);
        });

        it('min: exact original flattened to one line', () => {
            parseOk('const Card = ({ className }) => { function update(snaps) { const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0); } return <div />; };');
        });

        it('min: exact original with just the reduce line multi-lined', () => {
            parseOk('const Card = ({ className }) => {\n  const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);\n  return <div />;\n};');
        });

        it('min: func decl + filter/reduce + jsx return (single line)', () => {
            parseOk('const C = ({ x }) => { function u(snaps) { const h = a.filter(m => m.n === \'x\').reduce((p, c) => p + c.value, 0); } return <div />; };');
        });

        it('min: exact-A no filter', () => {
            parseOk('const Card = ({ className }) => {\n  function update(snaps) {\n    const hitsNow = latest.metrics.reduce((p, c) => p + c.value, 0);\n  }\n  return <div />;\n};');
        });

        it('min: exact-B no reduce', () => {
            parseOk('const Card = ({ className }) => {\n  function update(snaps) {\n    const hitsNow = latest.metrics.filter(m => m.name === \'x\');\n  }\n  return <div />;\n};');
        });

        it('min: exact-C filter+reduce no func decl', () => {
            parseOk('const Card = ({ className }) => {\n    const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);\n  return <div />;\n};');
        });

        it('min: reduce directly in body then jsx return (no func decl)', () => {
            parseOk('const C = ({ x }) => { const h = a.filter(m => m.n === \'x\').reduce((p, c) => p + c.value, 0); return <div />; };');
        });

        it('min: empty func decl then jsx return', () => {
            parseOk('const C = ({ x }) => { function u(s) { } return <div />; };');
        });

        it('min: func decl with reduce then jsx return', () => {
            parseOk('const C = ({ x }) => { function u(s) { const h = a.reduce((p, c) => p, 0); } return <div />; };');
        });

        it('min: orig-with-return-1', () => {
            parseOk('const Card = ({ className }) => {\n  function update(snaps) {\n    const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);\n  }\n  return 1;\n};');
        });

        it('min: orig-with-jsx-return', () => {
            parseOk('const Card = ({ className }) => {\n  function update(snaps) {\n    const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);\n  }\n  return <div />;\n};');
        });

        it('min: combo X — destructured + func decl + member-chain filter/reduce', () => {
            parseOk('const C = ({ x }) => { function u() { a.filter(m => m.n === \'x\').reduce((p, c) => p, 0); } };');
        });

        it('min: combo Y — combo X with a const initializer', () => {
            parseOk('const C = ({ x }) => { function u() { const h = a.filter(m => m.n === \'x\').reduce((p, c) => p, 0); } };');
        });

        it('min: combo Z — func decl with param, const, chained filter/reduce', () => {
            parseOk('const C = ({ x }) => { function u(snaps) { const h = a.filter(m => m.n === \'x\').reduce((p, c) => p + c.value, 0); } return 1; };');
        });

        it('min: destructured-param arrow-block with chained arrows', () => {
            parseOk('const C = ({ className }) => { g(a => a).reduce((p, c) => p, 0); };');
        });

        it('min: destructured-param arrow with member-chain filter/reduce', () => {
            parseOk('const C = ({ className }) => { a.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0); };');
        });

        it('min: function decl inside arrow-block with a chained arrow in its body', () => {
            parseOk('const C = () => { function u() { g(a => a).reduce((p, c) => p, 0); } };');
        });

        it('min: function decl inside arrow-block then a return', () => {
            parseOk('const C = () => { function u() { x(); } return 1; };');
        });

        it('parses a function declaration whose body has a chained-arrow statement', () => {
            parseOk([
                'function update(snaps: MetricsSnapshot[]): void {',
                '  const hitsNow: number = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);',
                '}'
            ].join('\n'));
        });

        it('parses a component whose body is a function declaration then a chained-arrow statement', () => {
            parseOk([
                'const Card = ({ className }) => {',
                '  function update(snaps) {',
                '    const hitsNow = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);',
                '  }',
                '  return <div />;',
                '};'
            ].join('\n'));
        });

        it('parses chained array methods with arrows and a union-typed annotation', () => {
            parseOk('const hitsNow: number = latest.metrics.filter(m => m.name === \'x\').reduce((p, c) => p + c.value, 0);');
        });

        it('parses find with an optional-union annotation', () => {
            parseOk('const startTimeMetric: Metric | undefined = latest.metrics.find(m => m.name === \'x\');');
        });

        it('parses conditional early returns of JSX in a component body', () => {
            parseOk([
                'const C = ({ ok }) => {',
                '  if (!ok) { return <Empty/>; }',
                '  return <Full/>;',
                '};'
            ].join('\n'));
        });
    });

    describe('statements', () => {
        it('parses control flow and loops', () => {
            parseOk([
                'function f(items) {',
                '  for (let i: number = 0; i < items.length; i++) { doThing(i); }',
                '  for (const x of items) { use(x); }',
                '  while (cond()) { break; }',
                '  try { risky(); } catch (e) { handle(e); } finally { cleanup(); }',
                '  return items;',
                '}'
            ].join('\n'));
        });

        it('parses labeled statements and labeled break', () => {
            const stmt: Statement = parseStatement('outer: { break outer; }');
            expect(stmt.kind).toBe('LabeledStatement');
        });
    });

    describe('diagnostics', () => {
        it('reports an unexpected token', () => {
            expect(parseError('const = ;')).toMatch(/identifier|unexpected/i);
        });

        it('reports an unterminated JSX element', () => {
            expect(parseError('const x = <div>oops;')).toMatch(/jsx|closing|unterminated|unexpected/i);
        });
    });
});