import { AstBlockStatement, AstExpression } from './ast.model';
import { resolveKeyForPathExpression } from './resolve-key-for-path-expression.function';
import { resolveAllKeys } from './resolve-tree.function';
import { JsonUtilities } from '../utilities/json.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
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
            res.push(...resolveAllKeys(element.program, parentKey));
            break;
        }
        case 'unless': {
            const key: string = getKeyFromUnlessParams(element.params, parentKey);
            res.push(key);
            res.push(...resolveAllKeys(element.program, parentKey));
            break;
        }
        case 'with':
        case 'log': {
            throw new Error(`Not implemented yet "${element.path.original}"`);
            // res.push(...resolveAllKeys(element.program, parentKey));
            // break;
        }
        default: {
            throw new Error(`Unknown AST path.original "${element.path.original}"`);
        }
    }
    return res;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getKeyFromArrayParams(params: AstExpression[], parentKey: string | undefined): string {
    if (params.length !== 1) {
        throw new Error(`Got more than 1 param ${JsonUtilities.stringify(params)}`);
    }

    switch (params[0].type) {
        case 'PathExpression': {
            return resolveKeyForPathExpression(params[0], parentKey);
        }
        case 'SubExpression': {
            if (params[0].params.length < 1) {
                throw new Error('SubExpression has no params');
            }
            // recursively pick the first param of the sub‐expression
            return getKeyFromArrayParams([params[0].params[0]], parentKey);
        }
        case 'StringLiteral':
        case 'NumberLiteral':
        case 'BooleanLiteral':
        case 'UndefinedLiteral':
        case 'NullLiteral':
        default: {
            throw new Error(`Unknown AST param for if block "${params[0].type}"`);
        }

    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getKeyFromIfParams(params: AstExpression[], parentKey: string | undefined): string {
    if (params.length !== 1) {
        throw new Error(`Got more than 1 param ${JsonUtilities.stringify(params)}`);
    }

    switch (params[0].type) {
        case 'PathExpression': {
            return resolveKeyForPathExpression(params[0], parentKey);
        }
        case 'SubExpression': {
            if (params[0].params.length < 1) {
                throw new Error('SubExpression has no params');
            }
            // recursively pick the first param of the sub‐expression
            return getKeyFromIfParams([params[0].params[0]], parentKey);
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

// eslint-disable-next-line jsdoc/require-jsdoc
function getKeyFromUnlessParams(params: AstExpression[], parentKey: string | undefined): string {
    return getKeyFromIfParams(params, parentKey);
}