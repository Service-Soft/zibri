import { getDependencyStackTrace } from './get-dependency-stack-trace.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { DiToken } from '../models/di-token.model';
import { InjectionToken } from '../models/injection-token.model';

/**
 * Get the no providers error message from the provided token and stack.
 * @param token - The token for which no provider was found.
 * @param resolvingStack - The stack of the DI trail.
 * @returns The message as a string.
 */
function getNoProviderMessage(token: DiToken<unknown>, resolvingStack: Function[]): string {
    if (token instanceof InjectionToken) {
        if (token.key.startsWith('Repository<') && token.key.endsWith('>')) {
            const entity: string = token.key.split('Repository<')[1].split('>')[0];
            return `No provider for repository token "${token.key}". Did you forget to register the entity "${entity}" in a data source?`;
        }
        if (!resolvingStack.length) {
            return `No provider for token "${token.key}". Did you forget to decorate it with @Inject()?`;
        }
        const currentClass: Function = resolvingStack[resolvingStack.length - 1];
        const injectTokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(currentClass);
        const index: number = Number(
            ObjectUtilities.entries(injectTokens)
                .find(([, t]) => t === token)
                ?.at(0) ?? -1
        );
        return `No provider for the token at index ${index} of class "${currentClass.name}". Did you forget to decorate it with @Inject()?`;
    }
    return `No provider for class "${token.name}". Did you forget to decorate it with @Injectable()?`;
}

/**
 * An error to throw when there was no provider found for injecting the provided DI token.
 */
export class NoProviderError extends InternalError {
    constructor(token: DiToken<unknown>, resolvingStack: Function[], options?: ErrorOptions) {
        const message: string = getNoProviderMessage(token, resolvingStack);
        super(message, options);
        this.name = 'NoProviderError';
        if (resolvingStack.length) {
            this.stack = getDependencyStackTrace(this.name, this.message, resolvingStack);
        }
    }
}