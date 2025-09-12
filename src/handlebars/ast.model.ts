/* eslint-disable jsdoc/require-jsdoc */
import { OmitStrict } from '../types';

export type AstProgram = OmitStrict<hbs.AST.Program, 'body'> & { body: AstStatement[] };

export type AstPathExpression = OmitStrict<
    hbs.AST.PathExpression,
    'parts' | 'original'
> & {
    original: string,
    parts: string[] // now guaranteed to be strings
};

export type AstBlockPathExpression = OmitStrict<AstPathExpression, 'original'> & {
    original: 'if' | 'each' | 'unless' | 'with' | 'log',
    parts: string[]
};

export type AstSubExpression = OmitStrict<hbs.AST.SubExpression, 'path' | 'params' | 'hash'> & {
    path: AstPathExpression,
    params: AstExpression[],
    hash: AstHash
};

export type AstStringLiteral = hbs.AST.StringLiteral;
export type AstNumberLiteral = hbs.AST.NumberLiteral;
export type AstBooleanLiteral = hbs.AST.BooleanLiteral;
export type AstUndefinedLiteral = hbs.AST.UndefinedLiteral;
export type AstNullLiteral = hbs.AST.NullLiteral;

// Union of everything that can appear as `param` or in a hash:
export type AstExpression
    = | AstPathExpression
        | AstStringLiteral
        | AstNumberLiteral
        | AstBooleanLiteral
        | AstUndefinedLiteral
        | AstNullLiteral
        | AstSubExpression;

export type AstHashPair = OmitStrict<
    hbs.AST.HashPair,
    'value'
> & { value: AstExpression };

export type AstHash = OmitStrict<hbs.AST.Hash, 'pairs'> & {
    pairs: AstHashPair[]
};

export type AstBlockStatement = OmitStrict<
    hbs.AST.BlockStatement,
    'path' | 'params' | 'hash' | 'program' | 'inverse'
> & {
    path: AstBlockPathExpression,
    params: AstExpression[],
    hash: AstHash,
    program: AstProgram,
    inverse?: AstProgram
};

export type AstCommentStatement = hbs.AST.CommentStatement;

export type AstContentStatement = hbs.AST.ContentStatement;

export type AstPartialStatement = OmitStrict<
    hbs.AST.PartialStatement,
    'name' | 'params' | 'hash'
> & {
    name: AstPathExpression,
    params: AstExpression[],
    hash: AstHash
};

export type AstMustacheStatement = OmitStrict<
    hbs.AST.MustacheStatement,
    'path' | 'params' | 'hash'
> & {
    path: AstPathExpression,
    params: AstExpression[],
    hash?: AstHash
};

export type AstPartialBlockStatement = OmitStrict<
    hbs.AST.PartialBlockStatement,
    'name' | 'params' | 'hash' | 'program'
> & {
    name: AstPathExpression,
    params: AstExpression[],
    hash: AstHash,
    program: AstProgram
};

export type AstStatement = AstBlockStatement
    | AstCommentStatement
    | AstContentStatement
    | AstPartialStatement
    | AstMustacheStatement
    | AstPartialBlockStatement;