import { AstMustacheStatement } from './ast.model';
import { resolveKeyForPath } from './resolve-key-for-path-expression.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveKeyForMustacheStatement(element: AstMustacheStatement, parentKey: string | undefined): string | undefined {
    return resolveKeyForPath(element.path.original, parentKey);
}