import { getDependencyStackTrace } from './get-dependency-stack-trace.function.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';
import { getAmbiguousRepositoryDataSources } from '../decorators/inject-repository.decorator.ts';
import { DiToken } from '../models/di-token.model.ts';
import { InjectionToken } from '../models/injection-token.model.ts';

/**
 * Get the no providers error message from the provided token and stack.
 * @param token - The token for which no provider was found.
 * @param resolvingStack - The stack of the DI trail.
 * @returns The message as a string.
 */
function getNoProviderMessage(token: DiToken<unknown>, resolvingStack: Function[]): string {
    if (token instanceof InjectionToken) {
        if (token.key.startsWith('Repository<') && token.key.endsWith('>')) {
            // the key was just checked to start with `Repository<` and end with `>`, so both halves
            // are there
            const entity: string = token.key.split('Repository<')[1]?.split('>')[0] ?? token.key;
            const ambiguousDataSources: string[] | undefined = getAmbiguousRepositoryDataSources(token.key);
            if (ambiguousDataSources?.length) {
                return [
                    `The entity "${entity}" is part of multiple data sources (${ambiguousDataSources.join(', ')}),`,
                    'so its repository cannot be resolved without naming one of them.',
                    `Use @InjectRepository(${entity}, ${ambiguousDataSources[0]}) instead.`
                ].join('\n');
            }
            return `No provider for repository token "${token.key}". Did you forget to register the entity "${entity}" in a data source?`;
        }
        const currentClass: Function | undefined = resolvingStack.at(-1);
        if (currentClass == undefined) {
            return `No provider for token "${token.key}". Did you forget to decorate it with @Inject()?`;
        }
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
 * Options for a {@link NoProviderError}.
 */
export type NoProviderErrorOptions = ErrorOptions & {
    /**
     * Whether nothing at all is registered, rather than this one token being absent.
     */
    containerIsEmpty?: boolean
};

/**
 * An error to throw when there was no provider found for injecting the provided DI token.
 */
export class NoProviderError extends InternalError {
    constructor(token: DiToken<unknown>, resolvingStack: Function[], options?: NoProviderErrorOptions) {
        // an empty container is a different problem wearing the same error, and the message for the
        // ordinary case sends the reader to the wrong place: it asks about a decorator, while the
        // token that failed is usually one of the framework's own, which no decorator governs
        const message: string = options?.containerIsEmpty === true
            ? [
                `No provider for token "${'key' in token ? token.key : token.name}", because nothing is registered at all.`,
                'The dependency injection container is empty, which means no application owns this process right now -',
                'either none has been initialized yet, or the last one has been shut down and released it.'
            ].join('\n')
            : getNoProviderMessage(token, resolvingStack);
        super(message, options);
        this.name = 'NoProviderError';
        if (resolvingStack.length) {
            this.stack = getDependencyStackTrace(this.name, this.message, resolvingStack);
        }
    }
}