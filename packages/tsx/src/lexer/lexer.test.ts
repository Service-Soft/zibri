import { describe, expect, it } from '@jest/globals';

import { Lexer, LexerMark } from './lexer';
import { Token, TokenType } from './token.model';
import { tokenTuples, tokenizeAll } from '../__testing__/tokenize.helper';

describe('Lexer', () => {
    describe('identifiers and keywords', () => {
        it('scans identifiers, including $ and _ and unicode', () => {
            expect(tokenTuples('foo $bar _baz café π')).toEqual([
                [TokenType.IDENTIFIER, 'foo'],
                [TokenType.IDENTIFIER, '$bar'],
                [TokenType.IDENTIFIER, '_baz'],
                [TokenType.IDENTIFIER, 'café'],
                [TokenType.IDENTIFIER, 'π']
            ]);
        });

        it('emits keywords as identifiers (distinguished by value)', () => {
            expect(tokenTuples('const x')).toEqual([
                [TokenType.IDENTIFIER, 'const'],
                [TokenType.IDENTIFIER, 'x']
            ]);
        });
    });

    describe('numbers', () => {
        it.each([
            ['42', '42'],
            ['3.14', '3.14'],
            ['.5', '.5'],
            ['1_000_000', '1_000_000'],
            ['0xFF', '0xFF'],
            ['0b1010', '0b1010'],
            ['0o755', '0o755'],
            ['1e10', '1e10'],
            ['1.5e-3', '1.5e-3'],
            ['10n', '10n']
        ])('scans %s', (src, value) => {
            expect(tokenTuples(src)).toEqual([[TokenType.NUMBER, value]]);
        });

        it('does not treat a leading dot before a non-digit as a number', () => {
            expect(tokenTuples('a.b')).toEqual([
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, '.'],
                [TokenType.IDENTIFIER, 'b']
            ]);
        });
    });

    describe('strings', () => {
        it('scans single and double quoted strings with escapes', () => {
            expect(tokenTuples('\'a\\\'b\' "c\\"d"')).toEqual([
                [TokenType.STRING, '\'a\\\'b\''],
                [TokenType.STRING, '"c\\"d"']
            ]);
        });

        it('keeps a </script> sequence intact inside a string', () => {
            expect(tokenTuples('"</script>"')).toEqual([[TokenType.STRING, '"</script>"']]);
        });
    });

    describe('comments and whitespace', () => {
        it('skips line and block comments', () => {
            const src: string = 'a // line\n /* block\n multi */ b';
            expect(tokenTuples(src)).toEqual([
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.IDENTIFIER, 'b']
            ]);
        });
    });

    describe('regex vs division', () => {
        it('treats / as regex at the start of an expression', () => {
            expect(tokenTuples('const re = /ab+c/gi')).toEqual([
                [TokenType.IDENTIFIER, 'const'],
                [TokenType.IDENTIFIER, 're'],
                [TokenType.PUNCTUATOR, '='],
                [TokenType.REGEX, '/ab+c/gi']
            ]);
        });

        it('treats / as division after an identifier or number', () => {
            expect(tokenTuples('a / b')).toEqual([
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, '/'],
                [TokenType.IDENTIFIER, 'b']
            ]);
            expect(tokenTuples('10 / 2')).toEqual([
                [TokenType.NUMBER, '10'],
                [TokenType.PUNCTUATOR, '/'],
                [TokenType.NUMBER, '2']
            ]);
        });

        it('treats / as regex after the return keyword', () => {
            expect(tokenTuples('return /x/')).toEqual([
                [TokenType.IDENTIFIER, 'return'],
                [TokenType.REGEX, '/x/']
            ]);
        });

        it('handles a slash inside a regex character class', () => {
            expect(tokenTuples('x = /[/]/')).toEqual([
                [TokenType.IDENTIFIER, 'x'],
                [TokenType.PUNCTUATOR, '='],
                [TokenType.REGEX, '/[/]/']
            ]);
        });

        it('treats / as division after a closing paren', () => {
            expect(tokenTuples('(a) / b')).toEqual([
                [TokenType.PUNCTUATOR, '('],
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, ')'],
                [TokenType.PUNCTUATOR, '/'],
                [TokenType.IDENTIFIER, 'b']
            ]);
        });
    });

    describe('punctuators', () => {
        it('matches multi-character operators greedily', () => {
            expect(tokenTuples('a ??= b === c => d')).toEqual([
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, '??='],
                [TokenType.IDENTIFIER, 'b'],
                [TokenType.PUNCTUATOR, '==='],
                [TokenType.IDENTIFIER, 'c'],
                [TokenType.PUNCTUATOR, '=>'],
                [TokenType.IDENTIFIER, 'd']
            ]);
        });

        it('scans ... spread and optional chaining', () => {
            expect(tokenTuples('...a?.b')).toEqual([
                [TokenType.PUNCTUATOR, '...'],
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, '?.'],
                [TokenType.IDENTIFIER, 'b']
            ]);
        });

        it('does not treat ?. before a digit as optional chaining', () => {
            expect(tokenTuples('a ? .5 : 0')).toEqual([
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, '?'],
                [TokenType.NUMBER, '.5'],
                [TokenType.PUNCTUATOR, ':'],
                [TokenType.NUMBER, '0']
            ]);
        });
    });

    describe('template literals', () => {
        it('scans a template with no substitutions as a single token', () => {
            expect(tokenTuples('`hello world`')).toEqual([[TokenType.TEMPLATE_FULL, '`hello world`']]);
        });

        it('splits a template into head/tail around a substitution', () => {
            expect(tokenTuples('`a${x}b`')).toEqual([
                [TokenType.TEMPLATE_HEAD, '`a${'],
                [TokenType.IDENTIFIER, 'x'],
                [TokenType.TEMPLATE_TAIL, '}b`']
            ]);
        });

        it('produces a middle segment for two substitutions', () => {
            expect(tokenTuples('`${a}-${b}`')).toEqual([
                [TokenType.TEMPLATE_HEAD, '`${'],
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.TEMPLATE_MIDDLE, '}-${'],
                [TokenType.IDENTIFIER, 'b'],
                [TokenType.TEMPLATE_TAIL, '}`']
            ]);
        });

        it('handles an object literal inside a substitution (brace disambiguation)', () => {
            expect(tokenTuples('`${ {a: 1} }`')).toEqual([
                [TokenType.TEMPLATE_HEAD, '`${'],
                [TokenType.PUNCTUATOR, '{'],
                [TokenType.IDENTIFIER, 'a'],
                [TokenType.PUNCTUATOR, ':'],
                [TokenType.NUMBER, '1'],
                [TokenType.PUNCTUATOR, '}'],
                [TokenType.TEMPLATE_TAIL, '}`']
            ]);
        });

        it('handles nested template literals inside substitutions', () => {
            expect(tokenTuples('`a${`b${c}d`}e`')).toEqual([
                [TokenType.TEMPLATE_HEAD, '`a${'],
                [TokenType.TEMPLATE_HEAD, '`b${'],
                [TokenType.IDENTIFIER, 'c'],
                [TokenType.TEMPLATE_TAIL, '}d`'],
                [TokenType.TEMPLATE_TAIL, '}e`']
            ]);
        });
    });

    describe('scanJsxText', () => {
        it('reads raw text up to the next < { or }', () => {
            const lexer: Lexer = new Lexer('Hello, world! <span>');
            const text: Token = lexer.scanJsxText();
            expect(text.type).toBe(TokenType.JSX_TEXT);
            expect(text.value).toBe('Hello, world! ');
        });

        it('preserves leading and internal whitespace', () => {
            const lexer: Lexer = new Lexer('   spaced   {expr}');
            expect(lexer.scanJsxText().value).toBe('   spaced   ');
        });

        it('returns an empty token when immediately at a delimiter', () => {
            const lexer: Lexer = new Lexer('<div>');
            expect(lexer.scanJsxText().value).toBe('');
        });
    });

    describe('mark and reset', () => {
        it('rewinds the cursor to a saved position', () => {
            const lexer: Lexer = new Lexer('a b c');
            expect(lexer.next().value).toBe('a');
            const mark: LexerMark = lexer.mark();
            expect(lexer.next().value).toBe('b');
            lexer.reset(mark);
            expect(lexer.next().value).toBe('b');
        });
    });

    describe('token spans', () => {
        it('records accurate start and end offsets', () => {
            const tokens: Token[] = tokenizeAll('  foo');
            expect(tokens[0]).toMatchObject({ value: 'foo', start: 2, end: 5 });
        });

        it('ends with an EOF token', () => {
            const tokens: Token[] = tokenizeAll('x');
            expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
        });
    });
});