import { AstProgram, AstStatement } from './ast.model';
import { PathTree } from './generate-handlebar-types.function';
import { resolveKeyForMustacheStatement } from './resolve-key-for-mustache-statement.function';
import { resolveKeysForBlockStatement } from './resolve-keys-for-block-statement.function';
import { resolveKeysForPartialStatement } from './resolve-keys-for-partial-statement.function';

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

function isParentArray(parts: string[], arrayKeys: string[]): boolean {
    if (parts.length <= 1) {
        return false;
    }
    const parent: string = parts.slice(0, parts.length - 1).join('.');
    return arrayKeys.includes(parent);
}

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
                if (element.path.original === 'this') {
                    // the statement is a reference to an item of string[], so no need to include it in keys.
                    continue;
                }
                const key: string = resolveKeyForMustacheStatement(element, parentKey);
                res.push(key);
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