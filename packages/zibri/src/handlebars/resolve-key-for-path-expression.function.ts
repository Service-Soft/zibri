import { AstPathExpression } from './ast.model';

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveKeyForPathExpression(expression: AstPathExpression, parentKey: string | undefined): string | undefined {
    return resolveKeyForPath(expression.original, parentKey);
}

/**
 * The key a path reads, the way handlebars looks it up: in the context of the block it is used in.
 *
 * A context below the root is written as the key it was taken from, each one below another joined by
 * `.this.`, as in `posts.this.author`. A bare `name` and `this.name` read from that context alike,
 * `../name` from the one around it and `@root.name` from the root. A data variable such as `@index`
 * or `@key` is no key of the context at all.
 * @param path - The path as the template writes it.
 * @param parentKey - The context it is used in, undefined at the root.
 * @returns The key, or undefined for a data variable.
 */
export function resolveKeyForPath(path: string, parentKey: string | undefined): string | undefined {
    if (path.startsWith('@')) {
        return path.startsWith('@root.') ? path.slice('@root.'.length) : undefined;
    }
    let context: string | undefined = parentKey;
    let rest: string = path;
    while (rest.startsWith('../')) {
        context = resolveEnclosingContext(context);
        rest = rest.slice('../'.length);
    }
    if (rest === 'this' || rest === '.') {
        return context;
    }
    if (rest.startsWith('this.')) {
        rest = rest.slice('this.'.length);
    }
    else if (rest.startsWith('./')) {
        rest = rest.slice('./'.length);
    }
    return context == undefined ? rest : `${context}.this.${rest}`;
}

/**
 * The context around another.
 * @param context - The context, undefined at the root.
 * @returns The one around it, undefined when that is the root.
 */
function resolveEnclosingContext(context: string | undefined): string | undefined {
    const index: number = context?.lastIndexOf('.this.') ?? -1;
    return context == undefined || index === -1 ? undefined : context.slice(0, index);
}