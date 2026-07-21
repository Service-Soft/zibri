import { AstPathExpression } from './ast.model';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveKeyForPathExpression(expression: AstPathExpression, parentKey: string | undefined): string {
    if (expression.original.startsWith('this.')) {
        return `${parentKey}.${expression.original}`;
    }
    return expression.original;
}