import { AstMustacheStatement } from './ast.model';

export function resolveKeyForMustacheStatement(element: AstMustacheStatement, parentKey: string | undefined): string {
    if (element.path.original.startsWith('this.')) {
        return `${parentKey}.${element.path.original}`;
    }
    return element.path.original;
}