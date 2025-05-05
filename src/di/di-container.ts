import { DiProvider } from './di-provider.model';
import { DiToken } from './di-token.model';
import { globalInjectables } from '../global';
import { Newable } from '../types';
import { NoProviderError } from './no-provider.error';
import { MetadataUtilities } from '../encapsulation';
import { CATALYX_DI_TOKENS } from './catalyx-di-tokens';
import { CLASS_FOR_CATALYX_DI_TOKENS } from './class-for-catalyx-di-tokens';

export class DiContainer {
    private readonly providers: Map<DiToken<unknown>, DiProvider<unknown>> = new Map<DiToken<unknown>, DiProvider<unknown>>();
    private readonly instances: Map<DiToken<unknown>, unknown> = new Map<DiToken<unknown>, unknown>();
    private static singleton?: DiContainer;

    private constructor() {
        for (const injectable of globalInjectables) {
            this.register(injectable);
        }
        for (const key in CATALYX_DI_TOKENS) {
            // eslint-disable-next-line stylistic/max-len
            const token: typeof CATALYX_DI_TOKENS[keyof typeof CATALYX_DI_TOKENS] = CATALYX_DI_TOKENS[key as keyof typeof CATALYX_DI_TOKENS];
            this.register({
                token,
                useClass: CLASS_FOR_CATALYX_DI_TOKENS[token]
            });
        }
    }

    static getInstance(): DiContainer {
        this.singleton ??= new DiContainer();
        return this.singleton;
    }

    register<T>(provider: DiProvider<T>): void {
        if (!provider.useClass && !provider.useFactory) {
            throw new Error(`Provider for token ${provider.token.toString()} must specify useClass or useFactory`);
        }
        this.providers.set(provider.token, provider);
    }

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
        const deps: unknown[] = paramTypes.map((inferred, idx) => {
            const token: DiToken<unknown> = explicitTokens[idx] ?? inferred;
            return this.inject(token, resolvingStack);
        });

        if (provider.useClass) {
            return new provider.useClass(...deps);
        }
        if (provider.useFactory) {
            return provider.useFactory(...deps);
        }

        throw new Error(`Provider for ${provider.token.toString()} is invalid`);
    }
}