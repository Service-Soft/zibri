import { AstBlockStatement, AstExpression, AstProgram } from './ast.model';
import { resolveKeyForPathExpression } from './resolve-key-for-path-expression.function';
import { resolveKeysForExpression } from './resolve-keys-for-partial-statement.function';
import { resolveAllKeys } from './resolve-tree.function';
import { InternalError } from '../error-handling/internal-error.model';
import { JsonUtilities } from '../utilities/json.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveKeysForBlockStatement(element: AstBlockStatement, parentKey: string | undefined): string[] {
    const res: string[] = [];
    // eg. if, each etc.
    switch (element.path.original) {
        // each rebinds the context to an item, with to the object it names. Their else branch renders
        // when there is nothing to rebind to, so it reads from where the block is used
        case 'each':
        case 'with': {
            const key: string = getKeyFromArrayParams(element.params, parentKey);
            res.push(key);
            res.push(...resolveAllKeys(element.program, key));
            res.push(...resolveInverseKeys(element.inverse, parentKey));
            break;
        }
        case 'if':
        case 'unless': {
            res.push(...getKeysFromConditionParams(element.params, parentKey));
            res.push(...resolveAllKeys(element.program, parentKey));
            res.push(...resolveInverseKeys(element.inverse, parentKey));
            break;
        }
        case 'log': {
            // what is logged is not something the template needs to render
            res.push(...resolveAllKeys(element.program, parentKey));
            res.push(...resolveInverseKeys(element.inverse, parentKey));
            break;
        }
        default: {
            // a helper the application registers, like `and`: what it is given is read from the
            // context, and its blocks render in the context it is used in
            for (const param of element.params) {
                res.push(...resolveKeysForExpression(param, parentKey));
            }
            for (const pair of element.hash?.pairs ?? []) {
                res.push(...resolveKeysForExpression(pair.value, parentKey));
            }
            res.push(...resolveAllKeys(element.program, parentKey));
            res.push(...resolveInverseKeys(element.inverse, parentKey));
            break;
        }
    }
    return res;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function resolveInverseKeys(inverse: AstProgram | undefined, parentKey: string | undefined): string[] {
    return inverse == undefined ? [] : resolveAllKeys(inverse, parentKey);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getKeyFromArrayParams(params: AstExpression[], parentKey: string | undefined): string {
    const param: AstExpression | undefined = params[0];
    if (params.length !== 1 || param == undefined) {
        throw new InternalError(`Got more than 1 param ${JsonUtilities.stringify(params)}`);
    }

    switch (param.type) {
        case 'PathExpression': {
            return resolveKeyForPathExpression(param, parentKey);
        }
        case 'SubExpression': {
            const first: AstExpression | undefined = param.params[0];
            if (first == undefined) {
                throw new InternalError('SubExpression has no params');
            }
            // recursively pick the first param of the sub‐expression
            return getKeyFromArrayParams([first], parentKey);
        }
        case 'StringLiteral':
        case 'NumberLiteral':
        case 'BooleanLiteral':
        case 'UndefinedLiteral':
        case 'NullLiteral':
        default: {
            throw new InternalError(`Unknown AST param for each block "${param.type}"`);
        }

    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getKeysFromConditionParams(params: AstExpression[], parentKey: string | undefined): string[] {
    const param: AstExpression | undefined = params[0];
    if (params.length !== 1 || param == undefined) {
        throw new InternalError(`Got more than 1 param ${JsonUtilities.stringify(params)}`);
    }
    // every key a sub expression is given, eg. both of `(and a b)`
    return resolveKeysForExpression(param, parentKey);
}