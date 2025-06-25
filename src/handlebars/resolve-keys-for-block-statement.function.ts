import { AstBlockStatement, AstExpression } from './ast.model';
import { resolveKeyForPathExpression } from './resolve-key-for-path-expression.function';
import { resolveAllKeys } from './resolve-tree.function';

export function resolveKeysForBlockStatement(element: AstBlockStatement, parentKey: string | undefined): string[] {
    const res: string[] = [];
    // eg. if, each etc.
    switch (element.path.original) {
        case 'each': {
            const key: string = getKeyFromArrayParams(element.params, parentKey);
            res.push(key);
            res.push(...resolveAllKeys(element.program, key));
            break;
        }
        case 'if': {
            const key: string = getKeyFromIfParams(element.params, parentKey);
            res.push(key);
            res.push(...resolveAllKeys(element.program, key));
            break;
        }
        case 'unless':
        case 'with':
        case 'log': {
            throw new Error(`Not implemented yet "${element.path.original}"`);
            res.push(...resolveAllKeys(element.program, parentKey));
            break;
        }
        default: {
            throw new Error(`Unknown AST path.original "${element.path.original}"`);
        }
    }
    return res;
}

function getKeyFromArrayParams(params: AstExpression[], parentKey: string | undefined): string {
    if (params.length !== 1) {
        throw new Error(`Got more than 1 param ${JSON.stringify(params)}`);
    }

    switch (params[0].type) {
        case 'PathExpression': {
            return resolveKeyForPathExpression(params[0], parentKey);
        }
        case 'StringLiteral':
        case 'NumberLiteral':
        case 'BooleanLiteral':
        case 'UndefinedLiteral':
        case 'NullLiteral':
        default: {
            throw new Error(`Unknown AST param for each block "${params[0].type}"`);
        }

    }
}

function getKeyFromIfParams(params: AstExpression[], parentKey: string | undefined): string {
    if (params.length !== 1) {
        throw new Error(`Got more than 1 param ${JSON.stringify(params)}`);
    }

    switch (params[0].type) {
        case 'PathExpression': {
            return resolveKeyForPathExpression(params[0], parentKey);
        }
        case 'SubExpression': {
            
        }
        case 'StringLiteral':
        case 'NumberLiteral':
        case 'BooleanLiteral':
        case 'UndefinedLiteral':
        case 'NullLiteral':
        default: {
            throw new Error(`Unknown AST param for each block "${params[0].type}"`);
        }

    }
}