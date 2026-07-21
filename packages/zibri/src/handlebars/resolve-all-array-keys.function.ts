import { AstBlockStatement, AstExpression, AstProgram, AstStatement } from './ast.model';
import { resolveKeyForPathExpression } from './resolve-key-for-path-expression.function';
import { InternalError } from '../error-handling/internal-error.model';
import { JsonUtilities } from '../utilities/json.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveAllArrayKeys(ast: AstProgram, parentKey: string | undefined): string[] {
    const res: string[] = [];
    for (const element of ast.body) {
        switch (element.type) {
            case 'BlockStatement': {
                res.push(...resolveArrayKeysForBlockStatement(element, parentKey));
                break;
            }
            case 'PartialBlockStatement': {
                // nested program, but do NOT mark params as arrays
                if (element.program) {
                    res.push(...resolveAllArrayKeys(element.program, parentKey));
                }
                break;
            }
            case 'PartialStatement':
            case 'CommentStatement':
            case 'MustacheStatement':
            case 'ContentStatement': {
                // reached leaf
                break;
            }
            default: {
                throw new InternalError(`Unknown AST Element ${(element as AstStatement).type}`);
            }
        }
    }

    return res;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function resolveArrayKeysForBlockStatement(element: AstBlockStatement, parentKey: string | undefined): string[] {
    const res: string[] = [];
    // eg. if, each etc.
    switch (element.path.original) {
        case 'each': {
            const key: string = getArrayKeyFromArrayParams(element.params, parentKey);
            res.push(key);
            res.push(...resolveAllArrayKeys(element.program, key));
            break;
        }
        case 'if':
        case 'unless':
        case 'with':
        case 'log': {
            res.push(...resolveAllArrayKeys(element.program, parentKey));
            break;
        }
        default: {
            throw new InternalError(`Unknown AST path.original "${element.path.original}"`);
        }
    }
    return res;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getArrayKeyFromArrayParams(params: AstExpression[], parentKey: string | undefined): string {
    if (params.length !== 1) {
        throw new InternalError(`Got more than 1 param ${JsonUtilities.stringify(params)}`);
    }

    switch (params[0].type) {
        case 'PathExpression': {
            return resolveKeyForPathExpression(params[0], parentKey);
        }
        case 'SubExpression': {
            if (params[0].params.length < 1) {
                throw new InternalError('SubExpression has no params');
            }
            // recursively pick the first param of the sub‐expression
            return getArrayKeyFromArrayParams([params[0].params[0]], parentKey);
        }
        case 'StringLiteral':
        case 'NumberLiteral':
        case 'BooleanLiteral':
        case 'UndefinedLiteral':
        case 'NullLiteral':
        default: {
            throw new InternalError(`Unknown AST param for each block "${params[0].type}"`);
        }

    }
}