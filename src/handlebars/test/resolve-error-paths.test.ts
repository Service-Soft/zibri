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

    it('throws "Not implemented yet" for a "with" block', () => {
        expect(() => resolveAllKeys(parse('{{#with x}}{{y}}{{/with}}'), undefined)).toThrow('Not implemented yet "with"');
    });

    it('throws "Not implemented yet" for a "log" block', () => {
        expect(() => resolveAllKeys(parse('{{#log x}}{{y}}{{/log}}'), undefined)).toThrow('Not implemented yet "log"');
    });

    it('throws for a block helper it does not recognize', () => {
        expect(() => resolveAllKeys(parse('{{#unknownHelper x}}{{y}}{{/unknownHelper}}'), undefined))
            .toThrow('Unknown AST path.original "unknownHelper"');
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

    it('throws when "if" is given a literal param', () => {
        expect(() => resolveAllKeys(parse('{{#if "lit"}}{{/if}}'), undefined)).toThrow('Unknown AST param for if block "StringLiteral"');
    });

    it('"unless" delegates to the same param validation as "if"', () => {
        expect(() => resolveAllKeys(parse('{{#unless a b}}{{/unless}}'), undefined)).toThrow('Got more than 1 param');
    });

    it('propagates through the public resolveTree entry point', () => {
        expect(() => resolveTree(parse('{{#with x}}{{y}}{{/with}}'), [])).toThrow('Not implemented yet "with"');
    });
});

describe('resolveAllArrayKeys — InternalError paths', () => {
    it('throws for an AST element type it does not know how to handle (decorator statement)', () => {
        expect(() => resolveAllArrayKeys(parse('{{* dec}}'), undefined)).toThrow('Unknown AST Element');
    });

    it('throws for a block helper it does not recognize', () => {
        expect(() => resolveAllArrayKeys(parse('{{#unknownHelper x}}{{y}}{{/unknownHelper}}'), undefined))
            .toThrow('Unknown AST path.original "unknownHelper"');
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