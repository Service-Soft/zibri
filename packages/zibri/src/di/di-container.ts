import { AlsUtilities } from '../context/als.utilities.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { Newable } from '../types/newable.type.ts';
import { MetadataUtilities } from '../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../utilities/object.utilities.ts';
import { CapturedRequestScopeError } from './errors/captured-request-scope.error.ts';
import { CircularDependencyError } from './errors/circular-dependency.error.ts';
import { InjectInsideAsyncFactoryError } from './errors/inject-inside-async-factory.error.ts';
import { MissedLifecycleHooksError } from './errors/missed-lifecycle-hooks.error.ts';
import { NoProviderError } from './errors/no-provider.error.ts';
import { OutsideRequestScopeError } from './errors/outside-request-scope.error.ts';
import { UninjectableParameterError } from './errors/uninjectable-parameter.error.ts';
import { UnresolvedAsyncProviderError } from './errors/unresolved-async-provider.error.ts';
import { implementsAfterAppInit } from '../global/after-app-init.interface.ts';
import { implementsAfterAppStart } from '../global/after-app-start.interface.ts';
import { implementsBeforeAppInit } from '../global/before-app-init.interface.ts';
import { LifecyclePhase } from '../global/lifecycle-phase.enum.ts';
import { implementsOnAppInit } from '../global/on-app-init.interface.ts';
import { implementsOnAppStart } from '../global/on-app-start.interface.ts';
import { DiProvider } from './models/di-provider.model.ts';
import { DiToken, tokenName } from './models/di-token.model.ts';
import { DiVariant } from './models/di-variant.model.ts';

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
 * The constructor a class is built with, and how many parameters it takes.
 */
type ConstructorArity = {
    /**
     * How many parameters the constructor declares.
     */
    count: number,
    /**
     * The class declaring the constructor: the class itself, or the ancestor it inherits it from.
     */
    declaredOn: Function
};

/**
 * The types that `design:paramtypes` carries when it carries no class.
 *
 * TypeScript serializes anything it cannot name at runtime - an interface, a union, a generic
 * parameter, a primitive - to one of these, and falls back to `Object` for a class that is not
 * defined yet because two modules import each other. None of them is a token anyone registers, so
 * seeing one means the metadata lost the type rather than that a provider is missing.
 */
const UNINJECTABLE_PARAM_TYPES: Set<unknown> = new Set<unknown>([
    Object,
    String,
    Number,
    Boolean,
    Array,
    Function,
    Symbol,
    Promise
]);

/**
 * The dependency injection container.
 */
export class DiContainer {
    private readonly providers: Map<DiToken<unknown>, DiProvider<unknown>> = new Map<DiToken<unknown>, DiProvider<unknown>>();
    private readonly instances: Map<DiToken<unknown>, unknown> = new Map<DiToken<unknown>, unknown>();
    /**
     * Tokens that were taken out of this container on purpose.
     *
     * `@Injectable` records a class globally and forever, and `inject` falls back to that record, so
     * without this an `unregister` would be undone by the next lookup.
     */
    private readonly unregistered: Set<DiToken<unknown>> = new Set<DiToken<unknown>>();
    /**
     * What is being constructed right now, outermost first.
     *
     * One array on the container rather than one per resolution, because it brackets a *synchronous*
     * call stack: everything a construction triggers happens before the provider returns, so nesting
     * is nesting whether the inner `inject` came from a constructor parameter or from a factory body.
     * Threading an array through the call chain instead is what used to miss the second case, since
     * `inject()` called inside a factory starts a fresh chain and loses every frame above it.
     *
     * **This holds only while providers are synchronous.** A factory that could `await` would leave
     * its frame here across a turn of the event loop, and an unrelated request for the same token
     * would then be reported as a cycle. Whoever gives the container async providers has to make this
     * per resolution.
     *
     * Also what names the trail in a {@link NoProviderError}, and what says whether a request scoped
     * value is about to be built into something that outlives the request.
     */
    private readonly constructing: DiProvider<unknown>[] = [];
    /**
     * How many asynchronous factories are running right now.
     *
     * Only ever above zero while an application initializes, and read on every `inject` to decide
     * whether asking async local storage where the call came from can tell it anything.
     */
    private asyncFactoriesRunning: number = 0;
    private static singleton?: DiContainer;

    private constructor() {}

    /**
     * Gets all registered tokens of the DI Container.
     *
     * Request scoped tokens are left out. Every caller of this injects what it gets back, and a
     * request scoped provider has nothing to build into outside a request - it throws rather than
     * answering, so returning it would turn a lifecycle sweep into a failed boot. A transient one is
     * returned like any other, since it builds a value here as readily as anywhere else.
     * @returns The tokens as an array.
     */
    getAllRegisteredTokens(): DiToken<unknown>[] {
        return this.getAllRegisteredProviders().map(p => p.token);
    }

    /**
     * Whether a token has a provider in this container, without building what it names.
     *
     * For the few readers that run both inside an application and outside one - a comparison a test
     * makes directly, say - and need a framework default rather than the failure `inject` answers a
     * missing registration with.
     * @param token - The token to look for.
     * @returns True when injecting it would find something.
     */
    isRegistered(token: DiToken<unknown>): boolean {
        return this.providers.has(token);
    }

    /**
     * The same set {@link getAllRegisteredTokens} reports, as the providers behind the tokens.
     *
     * What a provider is made of says things about the value that reading the token cannot - whether
     * it is a class at all, and what that class declares - and a caller deciding whether a value is
     * worth building has to know them before building it.
     * @returns The providers as an array.
     */
    getAllRegisteredProviders(): DiProvider<unknown>[] {
        return this.getRegisteredProviders().filter(p => p.scope !== 'request');
    }

    /**
     * Gets every value that has already been instantiated (constructed via `inject()`), without
     * constructing anything new. Unlike `getAllRegisteredTokens()`, this reflects only what's
     * actually live right now — needed for cleanup paths that must not force-create instances that
     * were never touched (eg. Tearing down after a failed app init).
     * @returns The already-instantiated values, deduplicated (the same instance can be cached under
     * multiple tokens, eg. A class's own token and its `useClass` provider token, see `inject()`).
     */
    getAllInstantiatedValues(): unknown[] {
        return [...new Set(this.instances.values())];
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
     * Discards the container, so the next application builds its own.
     *
     * Registering a provider replaces the provider and not the instance cached under it, which is
     * what makes this necessary rather than cosmetic: a container that outlived its application
     * would hand the next one the previous one's services, still holding its connections, timers and
     * sockets. Called at the end of `shutdown()`, once every teardown hook has run against them.
     */
    static reset(): void {
        this.singleton = undefined;
    }

    /**
     * Registers the provider for dependency injection.
     *
     * A token that is already registered is replaced, which is how the framework is configured
     * rather than an accident: a providers array is read front to back, so a later entry for a
     * token is the one that was meant. What cannot be settled that way - two plugins claiming one
     * token, where the winner would be decided by the order the plugins happen to be listed in -
     * is refused where the application is composed, with a `ProviderCollisionError`.
     * @param provider - The provider to register.
     */
    register<T>(provider: DiProvider<T>): void {
        this.providers.set(provider.token, provider);
        this.unregistered.delete(provider.token);
    }

    /**
     * Removes the provided token from the dependency injection system.
     *
     * Takes what was built under it with it, not just its provider: `inject` answers from the
     * instance cache before it looks at a provider at all, so a token whose value has already been
     * constructed would otherwise keep resolving forever. The entry keyed by the class goes too,
     * because it exists only as an alias of this provider's instance (see `inject`).
     *
     * Nothing is torn down here. The exported `unregister` is reachable only before the application
     * is initialized, so no lifecycle hook has run against what is being dropped.
     * @param token - The token to unregister.
     */
    unregister<T>(token: DiToken<T>): void {
        const provider: DiProvider<unknown> | undefined = this.providers.get(token);
        if (provider?.useClass) {
            this.instances.delete(provider.useClass);
        }
        this.instances.delete(token);
        this.providers.delete(token);
        this.unregistered.add(token);
    }

    /**
     * Finds the provider for a token, and remembers a globally declared one it had to go looking for.
     *
     * Both registries, not just the lazy one. `initDiContainer` reads `GlobalRegistry.injectables`
     * once, and `@Injectable` pushes onto it at module load - so whether a class was injectable used
     * to depend on whether its module happened to be imported before the container was built.
     * Anything loaded on demand - a plugin, a path read from configuration, a module required inside
     * a function - is decorated afterwards and was then unresolvable, with an error asking for a
     * decorator it already carries.
     * @param token - The token to find a provider for.
     * @returns The provider, or undefined when nothing declares one.
     * @throws A {@link MissedLifecycleHooksError} for a class that takes part in the lifecycle and
     * is being reached for the first time after the phases it asked for.
     */
    private resolveProvider<T>(token: DiToken<T>): DiProvider<T> | undefined {
        const registered: DiProvider<T> | undefined = this.providers.get(token) as DiProvider<T> | undefined;
        if (registered || this.unregistered.has(token)) {
            return registered;
        }

        const declared: DiProvider<unknown> | undefined = GlobalRegistry.lazyInjectables.find(p => p.token === token)
            ?? GlobalRegistry.injectables.find(p => p.token === token);
        if (!declared) {
            return undefined;
        }

        // this is the one moment the question is answerable. Which classes an application means to
        // build is not decidable while it starts - a package's services are registered by being
        // imported, and never building one of those is the ordinary case rather than the mistake -
        // but somebody asking for one *is* the application saying it wants it, and by then the
        // phases the class asked for are behind it.
        if (declared.useClass != undefined && this.isPastItsLifecycle(declared.useClass)) {
            throw new MissedLifecycleHooksError(declared.useClass);
        }

        this.register(declared); // promote into providers so future lookups are O(1)
        return declared as DiProvider<T>;
    }

    /**
     * Whether the given class declares a lifecycle hook whose phase the application has already
     * finished.
     *
     * By phase rather than by the application's state. Initializing is several phases, and a class
     * first built in the middle of them - by another class's constructor, or by a hook reaching for
     * it - still takes part in every phase that has not finished, because each phase picks up what
     * was built while it ran. Keyed on being initialized, such a class was built without the phases
     * it had missed and without being told; and a class declaring only a shutdown hook was refused
     * after startup, though shutdown reaches everything that exists by then.
     *
     * Outside an application no phase has finished, so a class built by a test or a script is built
     * like any other.
     * @param declaredClass - The class about to be constructed.
     * @returns True when building it now would skip a hook it declares.
     */
    private isPastItsLifecycle(declaredClass: Newable<unknown>): boolean {
        const prototype: unknown = declaredClass.prototype;
        const declares: Record<LifecyclePhase, boolean> = {
            [LifecyclePhase.BEFORE_APP_INIT]: implementsBeforeAppInit(prototype),
            [LifecyclePhase.ON_APP_INIT]: implementsOnAppInit(prototype),
            [LifecyclePhase.AFTER_APP_INIT]: implementsAfterAppInit(prototype),
            [LifecyclePhase.ON_APP_START]: implementsOnAppStart(prototype),
            [LifecyclePhase.AFTER_APP_START]: implementsAfterAppStart(prototype)
        };
        return ObjectUtilities.entries(declares).some(([phase, declared]) => declared && GlobalRegistry.isLifecyclePhaseFinished(phase));
    }

    /**
     * Injects the registered value for the provided token.
     * @param token - The token to inject the registered value from.
     * @returns The injected value.
     * @throws When no provider for the token could be found, when the found provider is invalid, or
     * when what it needs is already being constructed further up.
     */
    inject<T>(token: DiToken<T>): T {
        // the counter first, so the ordinary case does not pay for an async local storage lookup on
        // what is the framework's hottest call. It can only be above zero while an application is
        // initializing, which is the only time an asynchronous factory runs at all.
        if (this.asyncFactoriesRunning > 0) {
            const factory: string | undefined = AlsUtilities.getCurrentAsyncFactory();
            if (factory != undefined) {
                throw new InjectInsideAsyncFactoryError(factory, token);
            }
        }

        if (this.instances.has(token)) {
            return this.instances.get(token) as T;
        }

        const provider: DiProvider<T> | undefined = this.resolveProvider(token);
        if (!provider) {
            throw new NoProviderError(token, this.targetsOfConstructing(), { containerIsEmpty: !this.providers.size });
        }

        if (provider.useAsyncFactory) {
            throw new UnresolvedAsyncProviderError(token);
        }

        if (provider.scope === 'request') {
            return this.injectRequestScoped(provider);
        }

        // If useClass, check if we already have an instance of that class cached under the class itself
        if (provider.useClass && this.instances.has(provider.useClass)) {
            const existing: T = this.instances.get(provider.useClass) as T;
            this.instances.set(token, existing); // cache under this token too for next time
            return existing;
        }

        const instance: T = this.construct(provider);

        // only what is built. A `useValue` provider hands back the same value every time by
        // construction, so a cache saves it nothing - and it used to disagree with
        // `createInstanceFromProvider` about which values count, caching one whose value is an object
        // and not one whose value is null. Leaving them out settles that, and it is what lets a
        // provider registered later for the same token take effect: registering replaces the provider
        // and never the instance cached under it, so a cached value outlives the provider that named it
        if (provider.scope !== 'transient' && (provider.useFactory || provider.useClass)) {
            this.instances.set(provider.token, instance);

            if (provider.useClass) {
                this.instances.set(provider.useClass, instance);
            }
        }

        return instance;
    }

    /**
     * Injects the registered value for the provided token, awaiting it if it is built asynchronously.
     *
     * The application's initialization resolves every registered token through this, once, and that
     * is the only place a provider is ever awaited. What a `useAsyncFactory` resolved to is cached
     * like any other value, so every later injection - and every request - finds it already built,
     * which is what lets `inject()` stay synchronous.
     *
     * Everything that is not itself asynchronous is built exactly as `inject()` builds it, down to
     * which error it fails with. What this adds is the walk that has to happen first: a dependency
     * that has to be awaited must be awaited before whatever needs it is constructed, and by the
     * time construction starts there is no longer anywhere to wait.
     * @param token - The token to inject the registered value from.
     * @returns The injected value.
     * @throws The same as `inject()`, and a {@link CircularDependencyError} when two asynchronous
     * providers declare each other.
     */
    async injectAsync<T>(token: DiToken<T>): Promise<T> {
        return this.resolveAsync(token, []);
    }

    /**
     * Resolves a token, awaiting whatever below it has to be awaited.
     * @param token - The token to resolve.
     * @param chain - The asynchronous providers being awaited above this one, outermost first.
     * @returns The resolved value.
     */
    private async resolveAsync<T>(token: DiToken<T>, chain: DiToken<unknown>[]): Promise<T> {
        if (this.instances.has(token)) {
            return this.instances.get(token) as T;
        }

        const provider: DiProvider<T> | undefined = this.resolveProvider(token);
        if (provider?.useAsyncFactory == undefined) {
            // not asynchronous itself, but something it is built out of may be. Its constructor
            // parameters are the part of that the container can see without running anything; a
            // factory body is the part it cannot, which is what `deps` exists to say.
            //
            // Walking one already above us would be the cycle rather than a symptom of it, and is
            // left alone deliberately: `inject` below walks the same edges and throws the
            // CircularDependencyError, with the frames that say how construction got there.
            if (!chain.includes(token)) {
                for (const dependency of this.dependenciesOf(provider)) {
                    await this.resolveAsync(dependency, [...chain, token]);
                }
            }
            return this.inject(token);
        }

        // a plain argument rather than a stack on the container: the container drives this walk, so
        // the chain is where it already is, and two of these running at once cannot mix
        if (chain.includes(token)) {
            throw new CircularDependencyError([...chain, token].map(t => tokenName(t)));
        }

        const deps: unknown[] = [];
        for (const dependency of provider.deps ?? []) {
            deps.push(await this.resolveAsync(dependency, [...chain, token]));
        }

        this.asyncFactoriesRunning++;
        try {
            const instance: T = await AlsUtilities.runInAsyncFactory(
                tokenName(token),
                async () => (provider.useAsyncFactory as (...args: unknown[]) => Promise<T>)(...deps)
            );
            this.instances.set(provider.token, instance);
            return instance;
        }
        finally {
            this.asyncFactoriesRunning--;
        }
    }

    /**
     * Reads what the given provider is built out of, as far as that is visible without running it.
     * @param provider - The provider to read, or undefined when nothing declares one.
     * @returns The tokens it needs.
     */
    private dependenciesOf(provider: DiProvider<unknown> | undefined): DiToken<unknown>[] {
        if (provider?.useClass == undefined) {
            return [];
        }
        return this.parameterTokensOf(provider.useClass);
    }

    /**
     * Builds the value for a request scoped provider, or hands back the one this request already has.
     *
     * The instances map is never touched here. It outlives every request, so a value that landed in
     * it would answer the next request with the previous one's - which is the whole failure this
     * scope exists to make impossible.
     * @param provider - The provider to resolve.
     * @returns The value for the request currently being handled.
     * @throws An {@link OutsideRequestScopeError} when nothing is being handled, or a
     * {@link CapturedRequestScopeError} when the value would be built into something longer lived.
     */
    private injectRequestScoped<T>(provider: DiProvider<T>): T {
        const scope: Map<DiToken<unknown>, unknown> | undefined = AlsUtilities.getCurrentRequestContext()?.scopedInstances;
        if (!scope) {
            throw new OutsideRequestScopeError(provider.token);
        }

        if (scope.has(provider.token)) {
            return scope.get(provider.token) as T;
        }

        // the outermost frame rather than the nearest one, because it is what decides how long
        // everything under it is kept: a transient built for a singleton is discarded as a value and
        // held as a field all the same
        const holder: DiProvider<unknown> | undefined = this.constructing.at(0);
        if (holder != undefined && holder.scope !== 'request' && holder.scope !== 'transient') {
            throw new CapturedRequestScopeError(provider.token, holder.token);
        }

        const instance: T = this.construct(provider);
        scope.set(provider.token, instance);
        return instance;
    }

    /**
     * Builds the value for a provider, with the frame that says what is being built underneath it.
     * @param provider - The provider to build from.
     * @returns The built value.
     * @throws A {@link CircularDependencyError} when what it needs is already being built further up.
     */
    private construct<T>(provider: DiProvider<T>): T {
        const target: Function | undefined = (provider.useClass ?? provider.useFactory);
        if (target) {
            // an instance is kept only once its provider has returned, so a target already being
            // constructed can neither be answered from a cache nor built again - asking for it is
            // the recursion rather than a symptom of it
            const startOfCycle: number = this.constructing.findIndex(p => (p.useClass ?? p.useFactory) === target);
            if (startOfCycle !== -1) {
                throw new CircularDependencyError(
                    [...this.constructing.slice(startOfCycle), provider].map(p => tokenName(p.token))
                );
            }
            this.constructing.push(provider);
        }

        try {
            return this.createInstanceFromProvider(provider);
        }
        finally {
            // in a finally, and only for what was actually pushed. A failed construction that left
            // its frame behind would make the next honest attempt at the same class look like a
            // cycle, and popping for a `useValue` provider took the caller's frame instead.
            if (target) {
                this.constructing.pop();
            }
        }
    }

    private targetsOfConstructing(): Function[] {
        return this.constructing.map(p => (p.useClass ?? p.useFactory) as Function);
    }

    /**
     * Reads what has to be resolved to call the given class or factory, in parameter order.
     *
     * The whole of what the container can see about a dependency without running anything: an
     * `@Inject` token where there is one, and otherwise whatever the build wrote down about the
     * declared type. A standalone function carries neither, so this returns nothing for a factory.
     *
     * The count comes from the constructor itself rather than from what was written down about it,
     * because a build that emits no decorator metadata records nothing and leaving the count to the
     * metadata made every parameter of such a class disappear - the class was then constructed with
     * no arguments at all, and the first method to use one of them failed somewhere else entirely.
     * A constructor that gives a parameter a default is counted short by this, which only ever means
     * fewer refusals; one that is inherited is counted where it is declared.
     * @param provide - The class whose parameters to read.
     * @returns The token for each parameter, in order.
     * @throws An {@link UninjectableParameterError} for a parameter whose type nothing recorded.
     */
    private parameterTokensOf(provide: Function): DiToken<unknown>[] {
        const explicitTokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(provide);
        const paramTypes: unknown[] = MetadataUtilities.getParamTypes(provide);
        const { count: declaredParameterCount, declaredOn }: ConstructorArity = this.resolveConstructorArity(provide);

        // compute max number of parameters to resolve
        const highestExplicitIndex: number = ObjectUtilities.keys(explicitTokens).reduce((acc, k) => {
            const idx: number = Number(k);
            return Number.isFinite(idx) ? Math.max(acc, idx) : acc;
        }, -1);
        const paramCount: number = Math.max(paramTypes.length, highestExplicitIndex + 1, declaredParameterCount);

        const tokens: DiToken<unknown>[] = [];
        for (let idx: number = 0; idx < paramCount; idx++) {
            const explicitToken: DiToken<unknown> | undefined = explicitTokens[idx];
            if (explicitToken != undefined) {
                tokens.push(explicitToken);
                continue;
            }
            // what is left is whatever the type metadata says, and a built-in there is not a token
            // the container failed to find - it is the answer TypeScript gives when the type was
            // never a class to begin with, so asking for it produces a NoProviderError for "Object"
            const declaredType: unknown = paramTypes[idx];
            // something other than a function is what a compiler that sees one file at a time - swc,
            // oxc - records for an enum declared in another module: the enum object, where tsc records
            // Number. It names no class either, so it is answered as if nothing had been recorded
            if (typeof declaredType !== 'function' || UNINJECTABLE_PARAM_TYPES.has(declaredType)) {
                throw new UninjectableParameterError(
                    provide,
                    idx,
                    typeof declaredType === 'function' ? declaredType : undefined,
                    declaredOn,
                    this.targetsOfConstructing()
                );
            }
            tokens.push(declaredType as DiToken<unknown>);
        }

        return tokens;
    }

    /**
     * Finds the constructor a class is built with, and how many parameters it takes.
     *
     * A class declaring no constructor of its own runs the one it inherits, and reports an arity of
     * 0 for it - so read off the class alone, a subclass of a parent nothing records anything about
     * was built with no arguments, and the parent's constructor received undefined for everything it
     * asked for. That happens under every toolchain: a build recording types records them only for a
     * decorated class. Hence the walk to the nearest ancestor declaring parameters.
     *
     * Recorded parameter types stop the walk as well, because they are written for the constructor a
     * class declares itself: a decorated subclass declaring `constructor()` takes nothing, whatever its
     * parent takes. A build recording no types cannot tell that subclass from one inheriting its
     * constructor, and refuses it: a refusal names the class, where building it would hand the parent
     * undefined without a word.
     * @param cls - The class.
     * @returns The constructor's arity and the class declaring it.
     */
    private resolveConstructorArity(cls: Function): ConstructorArity {
        let current: unknown = cls;
        while (typeof current === 'function' && current !== Function.prototype) {
            if (current.length > 0 || MetadataUtilities.findOwnParamTypes(current) != undefined) {
                return { count: current.length, declaredOn: current };
            }
            current = Object.getPrototypeOf(current);
        }
        return { count: 0, declaredOn: cls };
    }

    private createInstanceFromProvider<T>(provider: DiProvider<T>): T {
        if ('useValue' in provider) {
            return provider.useValue as T;
        }

        if (provider.useClass) {
            // a class has to have every parameter filled
            const deps: unknown[] = this.parameterTokensOf(provider.useClass)
                .map(t => this.inject(t));
            return new provider.useClass(...deps);
        }
        // a sync factory takes nothing - its type refuses a parameter, and what it needs it reaches
        // for with `inject()` from inside its body
        if (provider.useFactory != undefined) {
            return provider.useFactory();
        }

        throw new InvalidProviderError((provider as DiProvider<T>).token.toString());
    }
}