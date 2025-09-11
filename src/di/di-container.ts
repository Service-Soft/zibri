import { GlobalRegistry } from '../global';
import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { ZIBRI_DI_TOKENS } from './default';
import { ZIBRI_DI_PROVIDERS } from './default/zibri-di-providers.default';
import { NoProviderError } from './errors/no-provider.error';
import { DiToken, DiProvider } from './models';

/**
 * The dependency injection container.
 */
export class DiContainer {
    private readonly providers: Map<DiToken<unknown>, DiProvider<unknown>> = new Map<DiToken<unknown>, DiProvider<unknown>>();
    private readonly instances: Map<DiToken<unknown>, unknown> = new Map<DiToken<unknown>, unknown>();
    private static singleton?: DiContainer;

    private constructor() {
        for (const injectable of GlobalRegistry.injectables) {
            this.register(injectable);
        }
        for (const key in ZIBRI_DI_TOKENS) {
            const token: typeof ZIBRI_DI_TOKENS[keyof typeof ZIBRI_DI_TOKENS] = ZIBRI_DI_TOKENS[key as keyof typeof ZIBRI_DI_TOKENS];
            this.register({ token, ...ZIBRI_DI_PROVIDERS[token] });
        }
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
        if (!provider.useClass && !provider.useFactory) {
            throw new Error(`Provider for token ${provider.token.toString()} must specify useClass or useFactory`);
        }
        this.providers.set(provider.token, provider);
    }

    /**
     * Removes the provided token from the dependency injection system.
     * @param token - The token to unregister.
     * @throws When the app is initialized or running.
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

        const provider: DiProvider<T> | undefined = this.providers.get(token) as DiProvider<T> | undefined;
        if (!provider) {
            throw new NoProviderError(token, resolvingStack);
        }

        if (!provider.useClass && !provider.useFactory) {
            throw new Error(`Provider for ${provider.token.toString()} is invalid`);
        }
        resolvingStack.push((provider.useClass ?? provider.useFactory) as Function);

        const instance: T = this.createInstanceFromProvider(provider, resolvingStack);
        resolvingStack.pop();

        this.instances.set(provider.token, instance);
        return instance;
    }

    private createInstanceFromProvider<T>(provider: DiProvider<T>, resolvingStack: Function[]): T {
        const provide: Newable<T> | ((...deps: unknown[]) => T) | undefined = provider.useClass ?? provider.useFactory;

        if (!provide) {
            throw new Error(`Provider for ${provider.token.toString()} is invalid`);
        }

        const explicitTokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(provide);
        const paramTypes: unknown[] = MetadataUtilities.getParamTypes(provide);

        // compute max number of parameters to resolve
        const highestExplicitIndex: number = Object.keys(explicitTokens).reduce((acc, k) => {
            const idx: number = Number(k);
            return Number.isFinite(idx) ? Math.max(acc, idx) : acc;
        }, -1);
        const paramCount: number = Math.max(paramTypes.length, highestExplicitIndex + 1);

        const deps: unknown[] = [];
        for (let idx: number = 0; idx < paramCount; idx++) {
            const token: DiToken<unknown> | undefined = explicitTokens[idx] ?? paramTypes[idx];
            if (token === undefined) {
                throw new Error('Could not find token');
            }
            else {
                deps.push(this.inject(token, resolvingStack));
            }
        }

        if (provider.useClass) {
            return new provider.useClass(...deps);
        }
        if (provider.useFactory) {
            return provider.useFactory(...deps);
        }

        throw new Error(`Provider for ${provider.token.toString()} is invalid`);
    }
}