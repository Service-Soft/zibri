import { expect } from '@jest/globals';

import { Expression, Program, Statement } from '../parser/ast';
import { parse, ParseResult } from '../parser/parser';

/**
 * Parses a source string and asserts there were no diagnostics, returning the program.
 * @param source - The source to parse.
 * @throws When parsing the given source returns at least one diagnostics.
 * @returns The parsed program.
 */
export function parseOk(source: string): Program {
    const result: ParseResult = parse(source);
    if (result.diagnostics.length > 0) {
        const first: ParseResult['diagnostics'][number] = result.diagnostics[0];
        throw new Error(`Unexpected diagnostic: ${first.message} at offset ${first.span.start}`);
    }
    if (!result.program) {
        throw new Error('Expected a program.');
    }
    return result.program;
}

/**
 * Asserts that parsing the given source produces at least one diagnostic, and returns the first.
 * @param source - The source to parse.
 * @returns The first diagnostic message.
 */
export function parseError(source: string): string {
    const result: ParseResult = parse(source);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    return result.diagnostics[0].message;
}

/**
 * Parses a single expression statement and returns its expression.
 * @param source - The expression source (without a trailing semicolon).
 * @throws When the given source isn't an expression.
 * @returns The parsed expression.
 */
export function parseExpression(source: string): Expression {
    const program: Program = parseOk(`${source};`);
    const statement: Statement | undefined = program.body[0] as Statement | undefined;
    if (!statement || statement.kind !== 'ExpressionStatement') {
        throw new Error(`Expected an expression statement, got ${statement?.kind ?? 'nothing'}.`);
    }
    return statement.expression;
}

/**
 * Parses source that is expected to contain a single top-level statement and returns it.
 * @param source - The source to parse.
 * @returns The first statement.
 */
export function parseStatement(source: string): Statement {
    const program: Program = parseOk(source);
    return program.body[0] as Statement;
}