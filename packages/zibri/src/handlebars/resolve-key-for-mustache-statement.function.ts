import { AstMustacheStatement } from './ast.model';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveKeyForMustacheStatement(element: AstMustacheStatement, parentKey: string | undefined): string {
    if (element.path.original.startsWith('this.')) {
        return `${parentKey}.${element.path.original}`;
    }
    return element.path.original;
}