import { AstProgram, AstStatement } from './ast.model';
import { PathTree } from './generate-handlebar-type-files.function';
import { resolveKeyForMustacheStatement } from './resolve-key-for-mustache-statement.function';
import { resolveKeysForBlockStatement } from './resolve-keys-for-block-statement.function';
import { resolveKeysForExpression, resolveKeysForPartialStatement } from './resolve-keys-for-partial-statement.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveTree(ast: AstProgram, arrayKeys: string[]): PathTree {
    const allKeys: string[] = [...new Set(resolveAllKeys(ast, undefined))];

    const root: PathTree = {};

    for (const key of allKeys) {
        const parts: string[] = key.split('.');
        let node: PathTree = root;

        const parentIsArray: boolean = isParentArray(parts, arrayKeys);
        for (const part of parts) {
            if (part === 'this') {
                continue;
            }
            if (part === 'length' && parentIsArray) {
                continue;
            }

            if (!(part in node)) {
                node[part] = {};
            }
            node = node[part];
        }
    }

    return root;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isParentArray(parts: string[], arrayKeys: string[]): boolean {
    if (parts.length <= 1) {
        return false;
    }
    const parent: string = parts.slice(0, parts.length - 1).join('.');
    return arrayKeys.includes(parent);
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveAllKeys(ast: AstProgram, parentKey: string | undefined): string[] {
    const res: string[] = [];
    for (const element of ast.body) {
        switch (element.type) {
            case 'BlockStatement': {
                res.push(...resolveKeysForBlockStatement(element, parentKey));
                break;
            }
            case 'MustacheStatement': {
                // reached leaf
                // 1) record the direct lookup, if any
                if (
                    element.path.original !== 'this'
                    && !element.params.length
                    && !element.hash?.pairs.length
                ) {
                    res.push(resolveKeyForMustacheStatement(element, parentKey));
                }
                // 2) now dive into any helper arguments to find nested keys!
                for (const param of element.params) {
                    res.push(...resolveKeysForExpression(param, parentKey));
                }
                for (const pair of element.hash?.pairs ?? []) {
                    res.push(...resolveKeysForExpression(pair.value, parentKey));
                }
                break;
            }
            case 'PartialStatement': {
                res.push(...resolveKeysForPartialStatement(element, parentKey));
                break;
            }
            case 'CommentStatement':
            case 'ContentStatement': {
                // reached leaf
                break;
            }
            case 'PartialBlockStatement':
            default: {
                throw new Error(`Unknown AST Element ${(element as AstStatement).type}`);
            }
        }
    }

    return res;
}