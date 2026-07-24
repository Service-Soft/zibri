import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { CLIENT_HOOK_SOURCES, HookData, substituteHookPlaceholders } from './hooks';
import { Expression, Program, Statement } from '../../parser/ast';
import { parse } from '../../parser/parser';
import { printStatement } from '../server/print';

// These tests guard against the client hook sources (plain JS strings in `hooks.ts`) drifting from
// zibri's real hook implementations. zibri's sources are read from disk, type-erased with our own
// parser/printer, evaluated, and compared against the client versions — both in API surface (so a
// new `$f` variant fails loudly) and in behavior.

const hooksDir: string = join(__dirname, '..', '..', '..', '..', 'zibri', 'src', 'preact', 'hooks');

// The shape of zibri's `$f` / our client `$f`.
type FormatHook = {
    date: (d: unknown) => string,
    time: (d: unknown) => string,
    dateTime: (d: unknown) => string,
    price: (a: unknown, c?: string) => string,
    percent: (v: number) => string
};

// A translation token as returned by `$t`.
type TranslationToken = {
    source: string,
    getValue: (locale: string) => string
};

type TranslateHook = (strings: string[], ...values: unknown[]) => TranslationToken;
type TranslateStringHook = (strings: string[], ...values: unknown[]) => string;

type FormatOptions = {
    locale: string,
    dateFormat: string,
    timeFormat: string,
    dateTimeFormat: string,
    currencyCode: string
};

const FORMAT_OPTIONS: FormatOptions = {
    locale: 'de-DE',
    dateFormat: 'DD.MM.YYYY',
    timeFormat: 'HH:mm',
    dateTimeFormat: 'DD.MM.YYYY HH:mm',
    currencyCode: 'EUR'
};

const TRANSLATIONS: Record<string, Record<string, string>> = { de: { greeting: 'hallo {name}' } };

const HOOK_DATA: HookData = { locale: 'de-DE', translations: TRANSLATIONS, formatOptions: FORMAT_OPTIONS };

// Parses one of zibri's hook source files with our own parser.
function parseHookFile(file: string): Program {
    const program: Program | undefined = parse(readFileSync(join(hooksDir, file), 'utf8')).program;
    assert(program, `failed to parse ${file}`);
    return program;
}

// Unwraps `export ...` so top-level declarations can be matched uniformly.
function topLevelStatements(program: Program): Statement[] {
    const out: Statement[] = [];
    for (const item of program.body) {
        if (item.kind === 'ExportDeclaration') {
            if (item.declaration) {
                out.push(item.declaration);
            }
        }
        else if (item.kind !== 'ImportDeclaration') {
            out.push(item);
        }
    }
    return out;
}

// Finds the initializer of a top-level `const <name> = ...`.
function constInitializer(program: Program, name: string): Expression {
    for (const statement of topLevelStatements(program)) {
        if (statement.kind !== 'VariableDeclaration') {
            continue;
        }
        for (const declarator of statement.declarations) {
            if (declarator.id.kind === 'IdentifierPattern' && declarator.id.name === name && declarator.init) {
                return declarator.init;
            }
        }
    }
    throw new Error(`no const '${name}' found`);
}

// Type-erases a top-level `function <name>` back to plain JavaScript via our printer.
function erasedFunction(program: Program, name: string): string {
    for (const statement of topLevelStatements(program)) {
        if (statement.kind === 'FunctionDeclaration' && statement.id === name) {
            return printStatement(statement);
        }
    }
    throw new Error(`no function '${name}' found`);
}

// Evaluates hook source(s) and returns the named binding.
function evaluateHook<T>(sources: string[], name: string): T {
    // eslint-disable-next-line typescript/no-implied-eval
    const factory: () => T = new Function(`${sources.join('\n')}\nreturn ${name};`) as () => T;
    return factory();
}

// Fills zibri's placeholder strings (quoted, as its runtime replaced them).
function fillZibriPlaceholders(source: string): string {
    return source
        .replaceAll('\'LOCALE_FORMAT_OPTIONS_PLACEHOLDER\'', JSON.stringify(FORMAT_OPTIONS))
        .replaceAll('\'TRANSLATIONS_PLACEHOLDER\'', JSON.stringify(TRANSLATIONS))
        .replaceAll('\'LOCALE_CODE_PLACEHOLDER\'', JSON.stringify('de-DE'));
}

// Extracts zibri's `$fHookCode` template literal as evaluable JavaScript.
function zibriFormatSource(): string {
    const code: Expression = constInitializer(parseHookFile('f.hook.ts'), '$fHookCode');
    assert(code.kind === 'TemplateLiteral' && code.expressions.length === 0);
    return fillZibriPlaceholders(code.quasis[0]);
}

describe('client hook parity with zibri', () => {
    describe('hook registry', () => {
        it('covers exactly the hooks zibri exposes', () => {
            const program: Program = parseHookFile('hooks.ts');

            const listed: Expression = constInitializer(program, 'preactHooks');
            assert(listed.kind === 'ArrayExpression');
            const fromList: string[] = listed.elements.map(element => {
                assert(element && element.kind === 'Identifier');
                return element.name;
            });

            const additional: Expression = constInitializer(program, 'preactAdditionalHookNames');
            assert(additional.kind === 'ArrayExpression');
            const fromAdditional: string[] = additional.elements.map(element => {
                assert(element && element.kind === 'StringLiteral');
                return element.value;
            });

            expect(new Set([...fromList, ...fromAdditional])).toEqual(new Set(Object.keys(CLIENT_HOOK_SOURCES)));
        });
    });

    describe('$f', () => {
        const zibri: FormatHook = evaluateHook<FormatHook>([zibriFormatSource()], '$f');
        const client: FormatHook = evaluateHook<FormatHook>(
            [substituteHookPlaceholders(CLIENT_HOOK_SOURCES['$f'], HOOK_DATA)],
            '$f'
        );
        const instant: number = new Date('2024-03-07T15:04:05Z').getTime();

        it('exposes the same set of formatters', () => {
            expect(new Set(Object.keys(client))).toEqual(new Set(Object.keys(zibri)));
        });

        it.each(['date', 'time', 'dateTime'] as const)('formats %s identically', method => {
            expect(client[method](instant)).toBe(zibri[method](instant));
        });

        it('formats prices identically, with and without an explicit currency', () => {
            expect(client.price(1234.5)).toBe(zibri.price(1234.5));
            expect(client.price(1234.5, 'USD')).toBe(zibri.price(1234.5, 'USD'));
        });

        it('formats percentages identically', () => {
            expect(client.percent(0.42)).toBe(zibri.percent(0.42));
        });
    });

    describe('$t / $ts', () => {
        const program: Program = parseHookFile('hooks.ts');
        const zibriT: string = fillZibriPlaceholders(erasedFunction(program, '$t'));
        const zibriTs: string = fillZibriPlaceholders(erasedFunction(program, '$ts'));
        const clientT: string = substituteHookPlaceholders(CLIENT_HOOK_SOURCES['$t'], HOOK_DATA);
        const clientTs: string = substituteHookPlaceholders(CLIENT_HOOK_SOURCES['$ts'], HOOK_DATA);

        const zibri: TranslateHook = evaluateHook<TranslateHook>([zibriT], '$t');
        const client: TranslateHook = evaluateHook<TranslateHook>([clientT], '$t');

        it('builds the same source for positional and named interpolations', () => {
            expect(client(['greeting']).source).toBe(zibri(['greeting']).source);
            expect(client(['a ', ' b'], { name: 'x' }).source).toBe(zibri(['a ', ' b'], { name: 'x' }).source);
            expect(client(['a ', ' b'], 'plain').source).toBe(zibri(['a ', ' b'], 'plain').source);
        });

        it('escapes braces in the source identically', () => {
            expect(client(['{literal}']).source).toBe(zibri(['{literal}']).source);
        });

        it.each(['de', 'de-DE', 'de-DE-x', 'en'])('resolves locale %s identically', locale => {
            expect(client(['greeting'], { name: 'Tim' }).getValue(locale))
                .toBe(zibri(['greeting'], { name: 'Tim' }).getValue(locale));
        });

        it('$ts resolves against the active locale identically', () => {
            const zibriFn: TranslateStringHook = evaluateHook<TranslateStringHook>([zibriT, zibriTs], '$ts');
            const clientFn: TranslateStringHook = evaluateHook<TranslateStringHook>([clientT, clientTs], '$ts');
            expect(clientFn(['greeting'], { name: 'Tim' })).toBe(zibriFn(['greeting'], { name: 'Tim' }));
        });
    });
});