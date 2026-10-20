import { AstExpression, AstPartialStatement } from './ast.model.ts';
import { resolveKeyForPathExpression } from './resolve-key-for-path-expression.function.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function resolveKeysForPartialStatement(
    stmt: AstPartialStatement,
    parentKey: string | undefined
): string[] {
    const res: string[] = [];

    // 1) positional params
    for (const param of stmt.params) {
        res.push(...resolveKeysForExpression(param, parentKey));
    }

    // 2) named params (hash)
    for (const pair of stmt.hash?.pairs ?? []) {
        res.push(...resolveKeysForExpression(pair.value, parentKey));
    }

    return res;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function resolveKeysForExpression(
    param: AstExpression,
    parentKey: string | undefined
): string[] {
    switch (param.type) {
        case 'PathExpression': {
            return [resolveKeyForPathExpression(param, parentKey)];
        }

        case 'SubExpression': {
            // unwrap its params & its hash
            const out: string[] = [];
            for (const p of param.params) {
                out.push(...resolveKeysForExpression(p, parentKey));
            }
            for (const pair of param.hash?.pairs ?? []) {
                out.push(...resolveKeysForExpression(pair.value, parentKey));
            }
            return out;
        }

        // everything else (StringLiteral, NumberLiteral, etc.) → no keys
        case 'StringLiteral':
        case 'NumberLiteral':
        case 'BooleanLiteral':
        case 'UndefinedLiteral':
        case 'NullLiteral': {
            return [];
        }
    }
}