import { AstMustacheStatement } from './ast.model.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function resolveKeyForMustacheStatement(element: AstMustacheStatement, parentKey: string | undefined): string {
    if (element.path.original.startsWith('this.')) {
        return `${parentKey}.${element.path.original}`;
    }
    return element.path.original;
}