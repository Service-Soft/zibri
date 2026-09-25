import { describe, expect, it } from '@jest/globals';

import { AstProgram } from '../ast.model';
import { HandlebarUtilities } from '../handlebar.utilities';
import { resolveAllArrayKeys } from '../resolve-all-array-keys.function';
import { resolveAllKeys, resolveTree } from '../resolve-tree.function';

function parse(src: string): AstProgram {
    return HandlebarUtilities.parse(src);
}

describe('resolveAllKeys — InternalError paths', () => {
    it('throws for an AST element type it does not know how to handle (decorator statement)', () => {
        expect(() => resolveAllKeys(parse('{{* dec}}'), undefined)).toThrow('Unknown AST Element');
    });

    it('throws when "each" is given more than one param', () => {
        expect(() => resolveAllKeys(parse('{{#each a b}}{{/each}}'), undefined)).toThrow('Got more than 1 param');
    });

    it('throws when "each" is given a param-less subexpression', () => {
        expect(() => resolveAllKeys(parse('{{#each (helper)}}{{/each}}'), undefined)).toThrow('SubExpression has no params');
    });

    it('throws when "each" is given a literal param', () => {
        expect(() => resolveAllKeys(parse('{{#each "lit"}}{{/each}}'), undefined)).toThrow('Unknown AST param for each block "StringLiteral"');
    });

    it('throws when "if" is given more than one param', () => {
        expect(() => resolveAllKeys(parse('{{#if a b}}{{/if}}'), undefined)).toThrow('Got more than 1 param');
    });

    it('"unless" delegates to the same param validation as "if"', () => {
        expect(() => resolveAllKeys(parse('{{#unless a b}}{{/unless}}'), undefined)).toThrow('Got more than 1 param');
    });

    it('propagates through the public resolveTree entry point', () => {
        expect(() => resolveTree(parse('{{#each a b}}{{/each}}'), [])).toThrow('Got more than 1 param');
    });
});

describe('resolveAllArrayKeys — InternalError paths', () => {
    it('throws for an AST element type it does not know how to handle (decorator statement)', () => {
        expect(() => resolveAllArrayKeys(parse('{{* dec}}'), undefined)).toThrow('Unknown AST Element');
    });

    it('throws when "each" is given more than one param', () => {
        expect(() => resolveAllArrayKeys(parse('{{#each a b}}{{/each}}'), undefined)).toThrow('Got more than 1 param');
    });

    it('throws when "each" is given a param-less subexpression', () => {
        expect(() => resolveAllArrayKeys(parse('{{#each (helper)}}{{/each}}'), undefined)).toThrow('SubExpression has no params');
    });

    it('throws when "each" is given a literal param', () => {
        expect(() => resolveAllArrayKeys(parse('{{#each "lit"}}{{/each}}'), undefined))
            .toThrow('Unknown AST param for each block "StringLiteral"');
    });
});