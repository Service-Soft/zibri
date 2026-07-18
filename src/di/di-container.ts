import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { NoProviderError } from './errors/no-provider.error';
import { DiProvider } from './models/di-provider.model';
import { DiToken } from './models/di-token.model';
import { DiVariant } from './models/di-variant.model';

/**
 * An error to throw when the given providerToken is invalid.
 */
class InvalidProviderError extends InternalError {
    constructor(providerToken: string) {
        super(`Provider for ${providerToken} is invalid`);
        this.name = 'InvalidProviderError';
    }
}

/**
 * The dependency injection container.
 */
export class DiContainer {
    private readonly providers: Map<DiToken<unknown>, DiProvider<unknown>> = new Map<DiToken<unknown>, DiProvider<unknown>>();
    private readonly instances: Map<DiToken<unknown>, unknown> = new Map<DiToken<unknown>, unknown>();
    private static singleton?: DiContainer;

    private constructor() {}

    /**
     * Gets all registered tokens of the DI Container.
     * @returns The tokens as an array.
     */
    getAllRegisteredTokens(): DiToken<unknown>[] {
        const seen: Set<unknown> = new Set<unknown>();
        const unique: DiToken<unknown>[] = [];

        for (const [token, provider] of this.providers) {
            const identity: unknown = provider.useClass ?? provider.useFactory ?? provider.useValue ?? token;
            if (!seen.has(identity)) {
                seen.add(identity);
                unique.push(token);
            }
        }

        return unique;
    }

    /**
     * Gets all providers of the given variant.
     * @param variant - The variant to filter by.
     * @returns All providers that are of the given variant.
     */
    getRegisteredProvidersOfVariant(variant: DiVariant): DiProvider<unknown>[] {
        return this.getRegisteredProviders().filter(p => (p.variants ?? []).includes(variant));
    }

    private getRegisteredProviders(): DiProvider<unknown>[] {
        const seen: Set<unknown> = new Set<unknown>();
        const unique: DiProvider<unknown>[] = [];

        for (const [token, provider] of this.providers) {
            const identity: unknown = provider.useClass ?? provider.useFactory ?? provider.useValue ?? token;
            if (!seen.has(identity)) {
                seen.add(identity);
                unique.push(provider);
            }
        }

        return unique;
    }

    /**
     * Gets the DI Container instance.
     * @returns The instance.
     */
    static getInstance(): DiContainer {
        this.singleton ??= new DiContainer();
        return this.singleton;
    }

    /**
     * Registers the provider for dependency injection.
     * @param provider - The provider to register.
     * @throws When the provider is invalid.
     */
    register<T>(provider: DiProvider<T>): void {
        this.providers.set(provider.token, provider);
    }

    /**
     * Removes the provided token from the dependency injection system.
     * @param token - The token to unregister.
     * @throws When the app is initialized or started.
     */
    unregister<T>(token: DiToken<T>): void {
        this.providers.delete(token);
    }

    /**
     * Injects the registered value for the provided token.
     * @param token - The token to inject the registered value from.
     * @param resolvingStack - The stack of the dependency injection.
     * @returns The injected value.
     * @throws When no provider for the token could be found or when the found provider is invalid.
     */
    inject<T>(token: DiToken<T>, resolvingStack: Function[] = []): T {
        if (this.instances.has(token)) {
            return this.instances.get(token) as T;
        }

        let provider: DiProvider<T> | undefined = this.providers.get(token) as DiProvider<T> | undefined;
        if (!provider) {
            const lazy: DiProvider<unknown> | undefined = GlobalRegistry.lazyInjectables.find(p => p.token === token);
            if (lazy) {
                this.register(lazy); // promote into providers so future lookups are O(1)
                provider = lazy as DiProvider<T>;
            }
        }

        if (!provider) {
            throw new NoProviderError(token, resolvingStack);
        }

        // If useClass, check if we already have an instance of that class cached under the class itself
        if (provider.useClass && this.instances.has(provider.useClass as unknown as DiToken<unknown>)) {
            const existing: T = this.instances.get(provider.useClass as unknown as DiToken<unknown>) as T;
            this.instances.set(token, existing); // cache under this token too for next time
            return existing;
        }

        if (provider.useClass || provider.useFactory) {
            resolvingStack.push(provider.useClass ?? provider.useFactory);
        }

        const instance: T = this.createInstanceFromProvider(provider, resolvingStack);
        resolvingStack.pop();

        if (provider.useValue != undefined || ((provider.useFactory || provider.useClass) && provider.cache !== false)) {
            this.instances.set(provider.token, instance);
        }

        if (provider.useClass && provider.cache !== false) {
            this.instances.set(provider.useClass as unknown as DiToken<unknown>, instance);
        }

        return instance;
    }

    private createInstanceFromProvider<T>(provider: DiProvider<T>, resolvingStack: Function[]): T {
        if ('useValue' in provider) {
            return provider.useValue as T;
        }

        const provide: Newable<T> | ((...deps: unknown[]) => T) | T | undefined = provider.useClass
            ?? provider.useFactory;

        if (provide == undefined) {
            throw new InvalidProviderError(provider.token.toString());
        }

        const explicitTokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(provide);
        const paramTypes: unknown[] = MetadataUtilities.getParamTypes(provide);

        // compute max number of parameters to resolve
        const highestExplicitIndex: number = ObjectUtilities.keys(explicitTokens).reduce((acc, k) => {
            const idx: number = Number(k);
            return Number.isFinite(idx) ? Math.max(acc, idx) : acc;
        }, -1);
        const paramCount: number = Math.max(paramTypes.length, highestExplicitIndex + 1);

        const deps: unknown[] = [];
        for (let idx: number = 0; idx < paramCount; idx++) {
            const token: DiToken<unknown> | undefined = explicitTokens[idx] ?? paramTypes[idx];
            if (token === undefined) {
                throw new InternalError('Could not find token');
            }
            else {
                deps.push(this.inject(token, resolvingStack));
            }
        }

        if (provider.useClass) {
            return new provider.useClass(...deps);
        }
        if (provider.useFactory != undefined) {
            return provider.useFactory(...deps);
        }

        throw new InvalidProviderError((provider as DiProvider<T>).token.toString());
    }
}