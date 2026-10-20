import { AstPathExpression } from './ast.model.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function resolveKeyForPathExpression(expression: AstPathExpression, parentKey: string | undefined): string {
    if (expression.original.startsWith('this.')) {
        return `${parentKey}.${expression.original}`;
    }
    return expression.original;
}