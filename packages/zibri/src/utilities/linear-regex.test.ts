/* eslint-disable cspell/spellchecker */
import { describe, expect, it } from '@jest/globals';

import { LinearRegex } from './linear-regex';

/**
 * A pattern tested against a value where the compiled pattern and the platform's RegExp answered differently.
 */
type Disagreement = {
    /**
     * The pattern.
     */
    pattern: string,
    /**
     * Its flags.
     */
    flags: string,
    /**
     * The value.
     */
    value: string,
    /**
     * What the platform's RegExp answered.
     */
    expected: boolean
};

/**
 * Random numbers from a seed, so that a pattern found to disagree is found again by the next run.
 * @param seed - The seed.
 * @returns The next number from 0 up to 1, each time it is called.
 */
function seededRandom(seed: number): () => number {
    let state: number = seed;
    return () => {
        state = (state + 0x6D_2B_79_F5) | 0;
        let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/**
 * Patterns built from every kind of part the compiled pattern puts together, nested.
 * @param random - Where the choices come from.
 * @param withGroups - Whether the patterns hold groups, which nest quantifiers the platform backtracks through.
 * @returns Something that builds one pattern each time it is called.
 */
function patternsFrom(random: () => number, withGroups: boolean = true): () => string {
    const pick: <T>(items: T[]) => T = items => items[Math.floor(random() * items.length)] as typeof items[number];
    const characters: string[] = [
        'a',
        'b',
        'A',
        'k',
        's',
        '_',
        ' ',
        '-',
        '.',
        String.raw`\d`,
        String.raw`\D`,
        String.raw`\w`,
        String.raw`\W`,
        String.raw`\s`,
        String.raw`\S`,
        String.raw`\n`,
        String.raw`\.`,
        String.raw`\x61`,
        String.raw`\u0062`,
        '[ab]',
        '[^a]',
        '[a-c]',
        String.raw`[\w-]`,
        '[]',
        '[^]',
        String.raw`[\]a]`,
        String.raw`\-`
    ];
    const assertions: string[] = ['^', '$', String.raw`\b`, String.raw`\B`];
    const quantifiers: string[] = ['', '', '', '*', '+', '?', '{2}', '{1,2}', '{0,}', '{0}', '*?', '+?', '??', '{1,3}?'];
    const build: (depth: number) => string = depth => {
        const terms: string[] = [];
        const count: number = 1 + Math.floor(random() * 3);
        for (let index: number = 0; index < count; index++) {
            const kind: number = random();
            if (kind < 0.15) {
                terms.push(pick(assertions));
            }
            else if (kind < 0.35 && depth < 3 && withGroups) {
                // no modifier groups: the platform answers some of them wrong, see the test of them below
                const group: string = pick(['(', '(?:', `(?<n${depth}${index}>`]);
                const inner: string = random() < 0.4 ? `${build(depth + 1)}|${build(depth + 1)}` : build(depth + 1);
                terms.push(`${group}${inner})${pick(quantifiers)}`);
            }
            else {
                terms.push(`${pick(characters)}${pick(quantifiers)}`);
            }
        }
        return terms.join('');
    };
    return () => build(0);
}

/**
 * Where the compiled pattern and the platform's RegExp answer differently.
 *
 * Asked of the platform the way ECMA-262 defines `test`: a match tried at each character in turn, a code point with
 * the unicode flag. Its own `test` also tries between the halves of a surrogate pair, see the test of that below.
 * @param pattern - The pattern.
 * @param flags - Its flags.
 * @param values - What each is tested against.
 * @returns Every value they disagree on.
 */
function findDisagreements(pattern: string, flags: string, values: string[]): Disagreement[] {
    const linear: LinearRegex = new LinearRegex(pattern, flags);
    const sticky: RegExp = new RegExp(pattern, `${flags}y`);
    const unicode: boolean = sticky.unicode || sticky.flags.includes('v');
    const matchesFrom: (value: string, start: number) => boolean = (value, start) => {
        sticky.lastIndex = start;
        return sticky.test(value);
    };
    const matches: (value: string) => boolean = value => {
        for (let start: number = 0; start <= value.length; start += unicode && (value.codePointAt(start) ?? 0) > 0xFF_FF ? 2 : 1) {
            if (matchesFrom(value, start)) {
                return true;
            }
        }
        return false;
    };
    return values
        .map(value => ({ pattern, flags, value, expected: matches(value) }))
        .filter(({ value, expected }) => linear.test(value) !== expected);
}

/**
 * Whether the platform takes a pattern, for syntax only some of the supported node versions know.
 * @param pattern - The pattern.
 * @param flags - Its flags.
 * @returns Whether it does.
 */
function isSupported(pattern: string, flags: string): boolean {
    try {
        return new RegExp(pattern, flags).source === pattern;
    }
    catch {
        return false;
    }
}

describe('LinearRegex', () => {
    it('answers what the platform answers, for patterns put together from every kind of part', () => {
        const random: () => number = seededRandom(20_261_117);
        const nextPattern: () => string = patternsFrom(random);
        const alphabet: string[] = ['a', 'A', 'b', 'k', 'K', 's', 'ſ', '_', '1', ' ', '\n', '\r', '.', '-', ']', '😀', '\uD83D'];
        const disagreements: Disagreement[] = [];
        const flagCombinations: string[] = ['', 'i', 'm', 's', 'u', 'v', 'im', 'is', 'iu', 'iv', 'mu', 'su', 'ims', 'imsu', 'imsv'];
        for (let round: number = 0; round < 3000; round++) {
            const pattern: string = nextPattern();
            const flags: string = flagCombinations[round % flagCombinations.length] ?? '';
            if (!isSupported(pattern, flags)) {
                continue;
            }
            const values: string[] = Array.from({ length: 24 }, () => Array.from(
                { length: Math.floor(random() * 8) },
                () => alphabet[Math.floor(random() * alphabet.length)]
            ).join(''));
            disagreements.push(...findDisagreements(pattern, flags, values));
        }

        expect(disagreements.slice(0, 10)).toStrictEqual([]);
    });

    it('answers what the platform answers for values with long runs of a few characters', () => {
        // patterns without groups, which the platform answers for a long value without backtracking for long
        const random: () => number = seededRandom(20_261_118);
        const nextPattern: () => string = patternsFrom(random, false);
        const alphabet: string[] = ['a', 'A', 'b', 'k', 'K', 's', 'ſ', '_', '1', ' ', '\n', '\r', '.', '-', ']', '😀', '\uD83D'];
        const pick: () => string = () => alphabet[Math.floor(random() * alphabet.length)] ?? '';
        const disagreements: Disagreement[] = [];
        const flagCombinations: string[] = ['', 'i', 'm', 's', 'u', 'v', 'im', 'is', 'iu', 'iv', 'mu', 'su', 'ims', 'imsu', 'imsv'];
        for (let round: number = 0; round < 3000; round++) {
            const pattern: string = nextPattern();
            const flags: string = flagCombinations[round % flagCombinations.length] ?? '';
            if (!isSupported(pattern, flags)) {
                continue;
            }
            const values: string[] = Array.from({ length: 12 }, () => {
                const run: string[] = Array.from({ length: 1 + Math.floor(random() * 3) }, pick);
                const middle: string = Array.from({ length: 16 + Math.floor(random() * 8) }, () => run[Math.floor(random() * run.length)]).join('');
                return `${pick()}${pick()}${middle}${pick()}${pick()}`;
            });
            disagreements.push(...findDisagreements(pattern, flags, values));
        }

        expect(disagreements.slice(0, 10)).toStrictEqual([]);
    });

    it('reads a character as the platform does: a code point with the unicode flag, a code unit without', () => {
        expect(findDisagreements('^.$', '', ['😀', 'a', '\uD83D'])).toStrictEqual([]);
        expect(findDisagreements('^.$', 'u', ['😀', 'a', '\uD83D'])).toStrictEqual([]);
        expect(findDisagreements('^😀+$', '', ['😀😀', '😀\uDE00'])).toStrictEqual([]);
        expect(findDisagreements('^😀+$', 'u', ['😀😀', '😀\uDE00'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\uD83D\uDE00$`, 'u', ['😀', '\uD83D'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\u{1F600}$`, 'u', ['😀', '\uD83D'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\uD83DA$`, 'u', ['\uD83DA', '\uD83D', 'A'])).toStrictEqual([]);
    });

    it('folds case the way the platform does, unicode and word boundaries included', () => {
        // ſ folds to s and the kelvin sign to k only with the unicode flag, and then counts as a word character
        expect(findDisagreements(String.raw`^s\b`, 'iu', ['ſ', 's', 'S '])).toStrictEqual([]);
        expect(findDisagreements(String.raw`\bk`, 'i', ['K', 'k', ' K'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`\bk`, 'iu', ['K', 'k', ' K'])).toStrictEqual([]);
        expect(findDisagreements('^straße$', 'i', ['STRASSE', 'STRAẞE', 'straße'])).toStrictEqual([]);
    });

    it('takes unicode properties and the set operations of the v flag', () => {
        expect(findDisagreements(String.raw`^\p{Lu}+$`, 'u', ['ÄÖ', 'äö', 'A1'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\P{L}$`, 'u', ['1', 'a'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^[\p{L}--[a-z]]+$`, 'v', ['ABC', 'abc', 'Äb'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^[[a-z]&&[aeiou]]+$`, 'v', ['aei', 'abc'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^[\q{x}a]$`, 'v', ['x', 'a', 'b'])).toStrictEqual([]);
    });

    it('refuses a class of the v flag that matches strings of several characters', () => {
        expect(() => new LinearRegex(String.raw`^[\q{abc}]$`, 'v')).toThrow(SyntaxError);
        expect(() => new LinearRegex(String.raw`^\p{RGI_Emoji}$`, 'v')).toThrow(SyntaxError);
    });

    it('reads the escapes of patterns without the unicode flag as the platform does', () => {
        // without a group, \1 is an octal escape; \c not followed by a letter is the backslash itself
        expect(findDisagreements(String.raw`^\1$`, '', ['\u0001', '1'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\101\8$`, '', ['A8', 'A'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^(a)\2$`, '', ['a\u0002'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\c1$`, '', ['\\c1', '\u0011'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\cJ$`, '', ['\n'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\k<a>$`, '', ['k<a>'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^a{,2}}$`, '', ['a{,2}}', 'aa'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\x4$`, '', ['x4'])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^\u{2}$`, '', ['uu', 'u{2}'])).toStrictEqual([]);
    });

    it('matches at line terminators with the multiline flag', () => {
        const separators: string = `a${String.fromCodePoint(0x20_28)}b${String.fromCodePoint(0x20_29)}c`;

        expect(findDisagreements('^b$', 'm', ['a\nb', 'a\rb\r', separators, 'ab'])).toStrictEqual([]);
        expect(findDisagreements('^b$', '', ['a\nb', separators])).toStrictEqual([]);
        expect(findDisagreements('a.b', 's', ['a\nb'])).toStrictEqual([]);
    });

    it('changes the flags for a part of the pattern in a modifier group', () => {
        const pattern: string = '^(?i:a)b(?-i:c)$';
        // modifier groups came with node 23, so on node 22 the platform refuses them as well
        if (!isSupported(pattern, 'i')) {
            expect(() => new LinearRegex(pattern, 'i')).toThrow(SyntaxError);
            return;
        }
        const values: string[] = ['Abc', 'ABc', 'abC'];

        expect(values.map(value => new LinearRegex(pattern, '').test(value))).toStrictEqual([true, false, false]);
        expect(values.map(value => new LinearRegex(pattern, 'i').test(value))).toStrictEqual([true, true, false]);
        expect(new LinearRegex('^(?m:^b)$', '').test('a\nb')).toBe(false);
        expect(new LinearRegex('^a(?m:$)', '').test('a\nb')).toBe(true);
        expect(new LinearRegex('^a(?s:.)b$', '').test('a\nb')).toBe(true);
        // a word boundary inside the group reads word characters with the group's flags: without i, ſ is none
        expect(new LinearRegex(String.raw`s(?-i:\B)$`, 'iu').test('ſ')).toBe(true);
        expect(new LinearRegex(String.raw`s(?:\B)$`, 'iu').test('ſ')).toBe(false);
    });

    it('answers a modifier group the way ECMA-262 defines it, where the platform does not', () => {
        if (!isSupported('(?-i:a)', 'i')) {
            return;
        }
        // the platform has answered true to both: folding the case of a repeated class inside (?-i:), and reading \W
        // after the group without the ignored case. Not in every run, so what it answers is not asserted here
        expect([new LinearRegex('(?-i:[a-c]{1,3}?)', 'i').test('A'), new LinearRegex(String.raw`(?-i:a)\W`, 'iu').test('as')])
            .toStrictEqual([false, false]);
        // what it answers for the same parts on their own
        expect([/(?-i:[a-c])/i.test('A'), /\W/iu.test('s')]).toStrictEqual([false, false]);
    });

    it('starts a match between two characters only, never between the halves of one', () => {
        // the platform's own `test` has started \B between the halves of a surrogate pair with the unicode flag,
        // which ECMA-262 never does: it moves to the next code point each time a match fails to start
        expect(new LinearRegex(String.raw`\B`, 'u').test('A😀a')).toBe(false);
        expect(new LinearRegex(String.raw`\B`, '').test('A😀a')).toBe(true);
    });

    it('runs a pattern that backtracks in time linear to the value', () => {
        const start: number = performance.now();
        const matched: boolean = new LinearRegex('^(a+)+$', '').test(`${'a'.repeat(100_000)}!`);

        expect(matched).toBe(false);
        expect(performance.now() - start).toBeLessThan(1000);
    });

    it('answers the same once it forgot the steps it worked out, for a pattern of more steps than it keeps', () => {
        // 100 characters matched apart, each in a different block, at 200 positions, and every rotation of them, so
        // that each character is read at each position: 20000 steps, more than the 10000 kept
        const characters: string[] = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4E_00 + (i * 0x1_01)));
        const rotations: string[] = characters.map((_, shift) => Array.from(
            { length: 200 },
            (__, i) => characters[(i + shift) % characters.length]
        ).join(''));
        // one compiled pattern for every value, so that the later ones are read after it forgot
        expect(findDisagreements(`^(?:${characters.join('|')}){0,200}$`, 'u', [...rotations, `${rotations[0]}x`, ...rotations]))
            .toStrictEqual([]);
    });

    it('reads every character of a value of many blocks as the platform does', () => {
        // every 97th code point, through every block of unicode, the surrogates included
        const value: string = Array.from({ length: Math.floor(0x11_00_00 / 97) }, (_, i) => String.fromCodePoint(i * 97)).join('');

        expect(findDisagreements(String.raw`^[\p{L}\p{N}\p{Cs}\s\W]+$`, 'u', [value])).toStrictEqual([]);
        expect(findDisagreements(String.raw`^(?:\p{L}|[^\p{L}])+$`, 'iu', [value, `${value}\uD800`])).toStrictEqual([]);
        expect(findDisagreements(String.raw`\bx\b`, 'iu', [value, `${value} x`])).toStrictEqual([]);
    });

    it('refuses lookarounds and backreferences', () => {
        for (const pattern of ['(?=a)', '(?!a)', '(?<=a)', '(?<!a)']) {
            expect(() => new LinearRegex(pattern, '')).toThrow('A lookaround cannot run in time linear to the value.');
        }
        expect(() => new LinearRegex(String.raw`(a)\1`, '')).toThrow('A backreference cannot run in time linear to the value.');
        expect(() => new LinearRegex(String.raw`(?<a>a)\k<a>`, '')).toThrow('A backreference cannot run in time linear to the value.');
        expect(() => new LinearRegex(String.raw`(a)\1`, 'u')).toThrow('A backreference cannot run in time linear to the value.');
    });

    it('refuses what the platform refuses', () => {
        expect(() => new LinearRegex('(a', '')).toThrow(SyntaxError);
        expect(() => new LinearRegex('a', 'x')).toThrow(SyntaxError);
    });
});