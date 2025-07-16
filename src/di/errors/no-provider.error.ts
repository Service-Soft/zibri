import { getDependencyStackTrace } from './get-dependency-stack-trace.function';
import { MetadataUtilities } from '../../utilities';
import { DiToken } from '../models';

// eslint-disable-next-line jsdoc/require-jsdoc
function tokenIsPrimitiveValue(token: DiToken<unknown>): boolean {
    return [String, Number, Boolean, Date].includes(
        token as unknown as StringConstructor | NumberConstructor | BooleanConstructor | DateConstructor
    );
}

/**
 * Get the no providers error message from the provided token and stack.
 * @param token - The token for which no provider was found.
 * @param resolvingStack - The stack of the DI trail.
 * @returns The message as a string.
 */
function getNoProviderMessage(token: DiToken<unknown>, resolvingStack: Function[]): string {
    if (typeof token === 'string') {
        if (token.startsWith('Repository<') && token.endsWith('>')) {
            const entity: string = token.split('Repository<')[1].split('>')[0];
            return `No provider for repository token "${token}". Did you forget to register the entity "${entity}" in a data source?`;
        }
        return `No provider for custom token "${token}"`;
    }
    if (tokenIsPrimitiveValue(token)) {
        if (!resolvingStack.length) {
            return `No provider for token "${token.name}". Did you forget to decorate it with @Inject()?`;
        }
        const currentClass: Function = resolvingStack[resolvingStack.length - 1];
        const paramTypes: unknown[] = MetadataUtilities.getParamTypes(currentClass);
        const index: number = paramTypes.findIndex(param => param === token);
        return `No provider for the token at index ${index} of class "${currentClass.name}". Did you forget to decorate it with @Inject()?`;
    }
    return `No provider for class "${token.name}". Did you forget to decorate it with @Injectable()?`;
}

/**
 * An error to throw when there was no provider found for injecting the provided DI token.
 */
export class NoProviderError extends Error {
    constructor(token: DiToken<unknown>, resolvingStack: Function[]) {
        const message: string = getNoProviderMessage(token, resolvingStack);
        super(message);
        this.name = 'NoProviderError';
        if (resolvingStack.length) {
            this.stack = getDependencyStackTrace(this.name, this.message, resolvingStack);
        }
    }
}