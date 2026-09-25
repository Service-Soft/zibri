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
        case 'with': {
            res.push(...resolveAllArrayKeys(element.program, getArrayKeyFromArrayParams(element.params, parentKey)));
            break;
        }
        // if, unless, log and any helper the application registers render their block in the context
        // they are used in
        case 'if':
        case 'unless':
        case 'log':
        default: {
            res.push(...resolveAllArrayKeys(element.program, parentKey));
            break;
        }
    }
    // the else branch of every block renders in the context the block is used in
    if (element.inverse != undefined) {
        res.push(...resolveAllArrayKeys(element.inverse, parentKey));
    }
    return res;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getArrayKeyFromArrayParams(params: AstExpression[], parentKey: string | undefined): string {
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
            return getArrayKeyFromArrayParams([first], parentKey);
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