import { beforeEach, describe, expect, it } from '@jest/globals';

import { Inject } from './decorators/inject.decorator';
import { Injectable } from './decorators/injectable.decorator';
import { DiContainer } from './di-container';
import { CapturedRequestScopeError } from './errors/captured-request-scope.error';
import { CircularDependencyError } from './errors/circular-dependency.error';
import { InjectInsideAsyncFactoryError } from './errors/inject-inside-async-factory.error';
import { NoProviderError } from './errors/no-provider.error';
import { OutsideRequestScopeError } from './errors/outside-request-scope.error';
import { UninjectableParameterError } from './errors/uninjectable-parameter.error';
import { UnresolvedAsyncProviderError } from './errors/unresolved-async-provider.error';
import { initDiContainer } from './init-di-container.function';
import { inject } from './inject.function';
import { defineProvider } from './models/di-provider.model';
import { DiToken } from './models/di-token.model';
import { InjectionToken } from './models/injection-token.model';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';

/**
 * The container reads the request scope off the request context, and the request context reaches
 * back through its tokens to route resolution and `inject()` - a require cycle. Nothing above
 * `./di-container` in the import list touches that ring, and jest gives every test file its own
 * module registry, so this file entering the ring at the container is the check: were the cycle to
 * stop resolving, the suite would not load at all.
 */

/**
 * Stands in for the request a handler runs inside.
 *
 * The context is the whole of what a request scope needs - it is created per request, entered for
 * as long as that request is handled, and dropped with it - so a request built out of nothing is
 * enough to hold one, and nothing here has to listen on a port.
 * @param fn - The function to run as if it were handling a request.
 * @returns The result of the function.
 */
async function asARequest<T>(fn: () => Promise<T> | T): Promise<T> {
    const context: HttpRequestContext = new HttpRequestContext(
        {} as unknown as HttpRequest,
        {} as unknown as HttpResponse
    );
    return AlsUtilities.runWithHttpRequestContext(context, async () => fn());
}

const requestScopedToken: InjectionToken<{ id: number }> = new InjectionToken<{ id: number }>('request-scoped-value');

let built: number = 0;

describe('DiContainer', () => {

    beforeEach(() => {
        DiContainer.reset();
        initDiContainer();
        built = 0;
        DiContainer.getInstance().register(defineProvider({
            token: requestScopedToken,
            scope: 'request',
            useFactory: () => ({ id: ++built })
        }));
    });

    describe('the registered tokens', () => {
        // the identity of a value provider was its value, so two tokens worth 0 were one entry
        it('lists two value providers that happen to share a primitive value', () => {
            const waitInMs: InjectionToken<number> = new InjectionToken<number>('wait-in-ms');
            const retries: InjectionToken<number> = new InjectionToken<number>('retries');
            DiContainer.getInstance().register(defineProvider({ token: waitInMs, useValue: 0 }));
            DiContainer.getInstance().register(defineProvider({ token: retries, useValue: 0 }));

            const tokens: DiToken<unknown>[] = DiContainer.getInstance().getAllRegisteredTokens();

            expect(tokens).toContain(waitInMs);
            expect(tokens).toContain(retries);
        });

        it('lists a class registered under two tokens once', () => {
            @Injectable()
            class Shared {}
            const alias: InjectionToken<Shared> = new InjectionToken<Shared>('shared-alias');
            DiContainer.getInstance().register(defineProvider({ token: alias, useClass: Shared }));

            const tokens: DiToken<unknown>[] = DiContainer.getInstance().getAllRegisteredTokens();

            expect(tokens.filter(token => token === alias || token === Shared)).toHaveLength(1);
        });

        it('answers nothing for a token that was unregistered', () => {
            @Injectable()
            class Dropped {}
            DiContainer.getInstance().register(defineProvider({ token: Dropped, useClass: Dropped }));

            DiContainer.getInstance().unregister(Dropped);

            expect(() => inject(Dropped)).toThrow(NoProviderError);
        });

        // injected first on purpose: inject reads the built instances before the providers, so deleting
        // the provider alone would leave anything already built live and injectable forever. The
        // application relies on this when it drops the orphan controllers it was not given
        it('evicts an instance that was already built when its token is unregistered', () => {
            @Injectable()
            class Built {}
            DiContainer.getInstance().register(defineProvider({ token: Built, useClass: Built }));
            expect(inject(Built)).toBeInstanceOf(Built);

            DiContainer.getInstance().unregister(Built);

            expect(() => inject(Built)).toThrow(NoProviderError);
        });
    });

    describe('request scope', () => {
        it('builds one value per request', async () => {
            const first: { id: number } = await asARequest(() => inject(requestScopedToken));
            const second: { id: number } = await asARequest(() => inject(requestScopedToken));

            expect(first).not.toBe(second);
            expect(built).toBe(2);
        });

        it('answers the same request with the value it already built', async () => {
            const [first, second]: { id: number }[] = await asARequest(() => [
                inject(requestScopedToken),
                inject(requestScopedToken)
            ]);

            expect(first).toBe(second);
            expect(built).toBe(1);
        });

        it('refuses to build one where no request bounds its life', () => {
            expect(() => inject(requestScopedToken)).toThrow(OutsideRequestScopeError);
        });

        it('refuses to be built into something that outlives the request', async () => {
            @Injectable()
            class KeptForever {
                readonly value: { id: number } = inject(requestScopedToken);
            }

            // constructed inside a request, so the value it asks for exists - what makes this wrong
            // is that KeptForever is kept, and would answer every later request with this one's value
            await expect(asARequest(() => inject(KeptForever))).rejects.toThrow(CapturedRequestScopeError);
        });

        it('refuses to be built into something kept that is first built for a request scoped holder', async () => {
            @Injectable()
            class KeptForever {
                readonly value: { id: number } = inject(requestScopedToken);
            }

            @Injectable({ scope: 'request' })
            class PerRequestHolder {
                constructor(readonly kept: KeptForever) {}
            }

            // the holder lives no longer than the request, but what it is built out of is kept - so
            // the first request would leave its value in place for every request after it
            await expect(asARequest(() => inject(PerRequestHolder))).rejects.toThrow(CapturedRequestScopeError);
            await expect(asARequest(() => inject(PerRequestHolder))).rejects.toThrow(CapturedRequestScopeError);
        });

        it('lets something built afresh for a request scoped holder hold it', async () => {
            @Injectable({ scope: 'transient' })
            class BuiltEveryTime {
                readonly value: { id: number } = inject(requestScopedToken);
            }

            @Injectable({ scope: 'request' })
            class PerRequestHolder {
                constructor(readonly fresh: BuiltEveryTime) {}
            }

            const first: PerRequestHolder = await asARequest(() => inject(PerRequestHolder));
            const second: PerRequestHolder = await asARequest(() => inject(PerRequestHolder));

            expect(first.fresh.value).not.toBe(second.fresh.value);
        });

        it('lets something that lives no longer than the request hold it', async () => {
            @Injectable({ scope: 'request' })
            class AlsoPerRequest {
                readonly value: { id: number } = inject(requestScopedToken);
            }

            const first: AlsoPerRequest[] = await asARequest(() => [inject(AlsoPerRequest), inject(AlsoPerRequest)]);
            const second: AlsoPerRequest = await asARequest(() => inject(AlsoPerRequest));

            // one holder and one held value for as long as the request lasts, and the next request
            // shares neither
            expect(first[0]).toBe(first[1]);
            expect(first[0]?.value).toBe(first[1]?.value);
            expect(first[0]?.value).not.toBe(second.value);
        });

        it('is left out of the tokens the lifecycle sweeps', () => {
            // app init injects every token this returns, which a request scoped provider answers by
            // throwing - so listing one here is a failed boot rather than a missed hook
            expect(DiContainer.getInstance().getAllRegisteredTokens()).not.toContain(requestScopedToken);
        });
    });

    describe('constructor injection', () => {
        it('says what it could not make a token out of when the type is not a class', () => {
            interface Clock {
                now: () => Date
            }

            @Injectable()
            class NeedsAClock {
                constructor(readonly clock: Clock) {}
            }

            // an interface leaves nothing behind at runtime, so the metadata says "Object" - which
            // used to be injected, and failed as a missing provider for a token nobody wrote
            expect(() => inject(NeedsAClock)).toThrow(UninjectableParameterError);
            expect(() => inject(NeedsAClock)).toThrow(/Parameter 0 of "NeedsAClock".*recorded as "Object"/s);
        });

        it('says what it could not make a token out of when there is no type at all', () => {
            @Injectable()
            class NeedsNothingReal {
                constructor(readonly nothing: undefined) {}
            }

            expect(() => inject(NeedsNothingReal)).toThrow(UninjectableParameterError);
            expect(() => inject(NeedsNothingReal))
                .toThrow(/Parameter 0 of "NeedsNothingReal".*nothing was recorded about its type/s);
        });

        it('leaves a parameter that names its own token alone', () => {
            const settingsToken: InjectionToken<{ retries: number }> = new InjectionToken<{ retries: number }>('settings');
            DiContainer.getInstance().register(defineProvider({ token: settingsToken, useValue: { retries: 3 } }));

            @Injectable()
            class NeedsSettings {
                constructor(
                    @Inject(settingsToken)
                    readonly settings: { retries: number }
                ) {}
            }

            // the declared type is an object literal, so the metadata says "Object" here too - what
            // the container reads is @Inject, and it never looks at the metadata for this parameter
            expect(inject(NeedsSettings).settings.retries).toBe(3);
        });

        describe('a class inheriting its constructor', () => {
            @Injectable()
            class Clock {
                now(): number {
                    return 1;
                }
            }

            /**
             * Not decorated, so nothing is recorded about its constructor's parameters.
             */
            abstract class UndecoratedBase {
                constructor(readonly clock: Clock) {}
            }

            /**
             * Decorated, so its constructor's parameter types are recorded.
             */
            @Injectable()
            class DecoratedBase {
                constructor(readonly clock: Clock) {}
            }

            /**
             * Names its constructor's tokens, which needs nothing recorded.
             */
            abstract class NamingBase {
                constructor(
                    @Inject(Clock)
                    readonly clock: Clock
                ) {}
            }

            it('refuses one whose inherited constructor nothing records, naming both classes', () => {
                @Injectable()
                class InheritsUnrecorded extends UndecoratedBase {}

                // it reports an arity of 0 of its own, so it used to be built with no arguments and
                // its parent handed undefined for the clock - found at the first call, somewhere else
                expect(() => inject(InheritsUnrecorded)).toThrow(UninjectableParameterError);
                expect(() => inject(InheritsUnrecorded))
                    .toThrow(/Parameter 0 of "InheritsUnrecorded", taken from the constructor of "UndecoratedBase"/);
            });

            it('builds one whose parent is decorated, with what the parent records', () => {
                @Injectable()
                class InheritsRecorded extends DecoratedBase {}

                expect(inject(InheritsRecorded).clock).toBe(inject(Clock));
            });

            it('builds one whose parent names its tokens', () => {
                @Injectable()
                class InheritsNamed extends NamingBase {}

                expect(inject(InheritsNamed).clock).toBe(inject(Clock));
            });

            it('builds one declaring a constructor that takes nothing, whatever its parent takes', () => {
                @Injectable()
                class TakesNothing extends UndecoratedBase {
                    constructor() {
                        super(new Clock());
                    }
                }

                // the recorded, empty parameter list is what says this class declares its own
                expect(inject(TakesNothing).clock.now()).toBe(1);
            });
        });
    });

    describe('asynchronous providers', () => {
        const vault: InjectionToken<{ secret: string }> = new InjectionToken<{ secret: string }>('vault');
        const pool: InjectionToken<{ dsn: string }> = new InjectionToken<{ dsn: string }>('pool');

        function provideVault(): void {
            DiContainer.getInstance().register(defineProvider({
                token: vault,
                useAsyncFactory: async () => Promise.resolve({ secret: 'hunter2' })
            }));
        }

        it('awaits the factory, and is a plain value from then on', async () => {
            provideVault();

            expect(await DiContainer.getInstance().injectAsync(vault)).toEqual({ secret: 'hunter2' });
            // the whole point of resolving it during initialization: nothing after this has to wait
            expect(inject(vault).secret).toBe('hunter2');
        });

        it('resolves what a factory declares before running it, whatever order they were registered in', async () => {
            // the pool first, so registration order is the wrong order
            DiContainer.getInstance().register(defineProvider({
                token: pool,
                deps: [vault],
                useAsyncFactory: async (secrets: { secret: string }) => Promise.resolve({ dsn: `db://${secrets.secret}` })
            }));
            provideVault();

            expect((await DiContainer.getInstance().injectAsync(pool)).dsn).toBe('db://hunter2');
        });

        it('follows the constructor parameters of a class it is given', async () => {
            provideVault();

            @Injectable()
            class Migrations {
                constructor(
                    @Inject(vault)
                    readonly secrets: { secret: string }
                ) {}
            }

            const token: InjectionToken<string> = new InjectionToken<string>('runs-migrations');
            DiContainer.getInstance().register(defineProvider({
                token,
                deps: [Migrations],
                useAsyncFactory: async (migrations: Migrations) => Promise.resolve(migrations.secrets.secret)
            }));

            // Migrations is not asynchronous, but it cannot be constructed until the vault is - and
            // what it needs is visible in its constructor, so nothing about it has to be declared
            expect(await DiContainer.getInstance().injectAsync(token)).toBe('hunter2');
        });

        // the walk sees constructor parameters and
        // `deps` only, so a value reached for anywhere else worked or failed by registration order
        it('awaits a value a class reaches for in a field initializer', async () => {
            @Injectable()
            class Warm {
                readonly secrets: { secret: string } = inject(vault);
            }
            // after the class, as an application's providers always are
            provideVault();

            expect((await DiContainer.getInstance().injectAsync(Warm)).secrets.secret).toBe('hunter2');
        });

        it('awaits a value a synchronous factory reaches for in its body', async () => {
            const dsn: InjectionToken<string> = new InjectionToken<string>('dsn-from-a-factory');
            DiContainer.getInstance().register(defineProvider({
                token: dsn,
                useFactory: () => `db://${inject(vault).secret}`
            }));
            provideVault();

            expect(await DiContainer.getInstance().injectAsync(dsn)).toBe('db://hunter2');
        });

        it('awaits a value hidden behind a class an asynchronous factory declares', async () => {
            @Injectable()
            class Pool {
                readonly secrets: { secret: string } = inject(vault);
            }

            const token: InjectionToken<string> = new InjectionToken<string>('reads-through-a-hidden-value');
            DiContainer.getInstance().register(defineProvider({
                token,
                deps: [Pool],
                useAsyncFactory: async (pool: Pool) => Promise.resolve(pool.secrets.secret)
            }));
            provideVault();

            expect(await DiContainer.getInstance().injectAsync(token)).toBe('hunter2');
        });

        it('builds what a class reached for before the awaited value once', async () => {
            let clocksBuilt: number = 0;

            @Injectable()
            class CountedClock {
                constructor() {
                    clocksBuilt++;
                }
            }

            @Injectable()
            class ReadsBoth {
                readonly clock: CountedClock = inject(CountedClock);
                readonly secrets: { secret: string } = inject(vault);
            }
            provideVault();

            const built: ReadsBoth = await DiContainer.getInstance().injectAsync(ReadsBoth);

            expect(built.secrets.secret).toBe('hunter2');
            expect(clocksBuilt).toBe(1);
        });

        it('names a cycle that runs through a value a class reaches for', async () => {
            const looped: InjectionToken<string> = new InjectionToken<string>('hidden-cycle');

            @Injectable()
            class ReadsTheLoop {
                readonly value: string = inject(looped);
            }
            DiContainer.getInstance().register(defineProvider({
                token: looped,
                deps: [ReadsTheLoop],
                useAsyncFactory: async (reader: ReadsTheLoop) => Promise.resolve(reader.value)
            }));

            await expect(DiContainer.getInstance().injectAsync(looped))
                .rejects.toThrow(/hidden-cycle.*ReadsTheLoop.*hidden-cycle/s);
        });

        it('refuses inject() in the factory, on both sides of an await', async () => {
            provideVault();

            const straightAway: InjectionToken<string> = new InjectionToken<string>('reaches-out-straight-away');
            DiContainer.getInstance().register(defineProvider({
                token: straightAway,
                useAsyncFactory: async () => Promise.resolve(inject(vault).secret)
            }));

            const afterAwaiting: InjectionToken<string> = new InjectionToken<string>('reaches-out-after-awaiting');
            DiContainer.getInstance().register(defineProvider({
                token: afterAwaiting,
                useAsyncFactory: async () => {
                    await Promise.resolve();
                    return inject(vault).secret;
                }
            }));

            // both would have worked here, because the vault happens to be resolved already - which
            // is exactly why they are refused: it works or not by the order things are registered in
            await expect(DiContainer.getInstance().injectAsync(straightAway))
                .rejects.toThrow(InjectInsideAsyncFactoryError);
            // and this is what the mark has to live in async local storage for: a flag set around
            // the call would have been cleared by the time the line after the await runs
            await expect(DiContainer.getInstance().injectAsync(afterAwaiting))
                .rejects.toThrow(InjectInsideAsyncFactoryError);
        });

        it('lets the factory use what it declared, whatever that reaches for itself', async () => {
            const zone: InjectionToken<string> = new InjectionToken<string>('zone');
            DiContainer.getInstance().register(defineProvider({ token: zone, useFactory: () => 'UTC' }));

            @Injectable()
            class Formatter {
                // at call time, as a repository reaches for its tracer
                getZone(): string {
                    return inject(zone);
                }
            }

            const formatted: InjectionToken<string> = new InjectionToken<string>('formatted');
            DiContainer.getInstance().register(defineProvider({
                token: formatted,
                deps: [Formatter],
                useAsyncFactory: async (formatter: Formatter) => Promise.resolve(formatter.getZone())
            }));

            // a value that is not awaited is built on demand, so finding it does not depend on order
            expect(await DiContainer.getInstance().injectAsync(formatted)).toBe('UTC');
        });

        it('refuses an awaited value reached for through what the factory declared', async () => {
            provideVault();
            await DiContainer.getInstance().injectAsync(vault);

            @Injectable()
            class ReadsTheVault {
                getSecret(): string {
                    return inject(vault).secret;
                }
            }

            const token: InjectionToken<string> = new InjectionToken<string>('reads-the-vault-late');
            DiContainer.getInstance().register(defineProvider({
                token,
                deps: [ReadsTheVault],
                useAsyncFactory: async (reader: ReadsTheVault) => Promise.resolve(reader.getSecret())
            }));

            // resolved already, and refused all the same: it would work or not by the order things are
            // registered in
            await expect(DiContainer.getInstance().injectAsync(token)).rejects.toThrow(InjectInsideAsyncFactoryError);
        });

        it('names two asynchronous providers that declare each other', async () => {
            const first: InjectionToken<string> = new InjectionToken<string>('async-cycle-first');
            const second: InjectionToken<string> = new InjectionToken<string>('async-cycle-second');
            DiContainer.getInstance().register(defineProvider({
                token: first,
                deps: [second],
                useAsyncFactory: async () => Promise.resolve('first')
            }));
            DiContainer.getInstance().register(defineProvider({
                token: second,
                deps: [first],
                useAsyncFactory: async () => Promise.resolve('second')
            }));

            await expect(DiContainer.getInstance().injectAsync(first))
                .rejects.toThrow(/async-cycle-first.*async-cycle-second/s);
        });

        it('names a cycle among the classes it walks through, rather than recursing into it', async () => {
            const left: InjectionToken<object> = new InjectionToken<object>('walked-cycle-left');
            const right: InjectionToken<object> = new InjectionToken<object>('walked-cycle-right');

            @Injectable({ token: left })
            class WalkedCycleLeft {
                constructor(
                    @Inject(right)
                    readonly other: object
                ) {}
            }

            @Injectable({ token: right })
            class WalkedCycleRight {
                constructor(
                    @Inject(left)
                    readonly other: object
                ) {}
            }

            const token: InjectionToken<string> = new InjectionToken<string>('needs-a-cycle');
            DiContainer.getInstance().register(defineProvider({
                token,
                deps: [left],
                useAsyncFactory: async () => Promise.resolve('never gets here')
            }));

            // the walk that finds what has to be awaited follows the same edges construction does,
            // so it has to stop where construction would - two classes naming each other is a cycle,
            // not something to keep descending into
            await expect(DiContainer.getInstance().injectAsync(token))
                .rejects.toThrow(CircularDependencyError);
            expect(WalkedCycleLeft).toBeDefined();
            expect(WalkedCycleRight).toBeDefined();
        });

        it('refuses one the initialization sweep never reached', () => {
            provideVault();

            // registered after the sweep awaited the others, so it is first asked for where there is
            // nobody left to await it
            expect(() => inject(vault)).toThrow(UnresolvedAsyncProviderError);
            expect(() => inject(vault)).toThrow(/registered after\s+the application started awaiting/);
        });
    });

    describe('transient scope', () => {
        it('builds a new value on every injection', () => {
            const token: InjectionToken<{ id: number }> = new InjectionToken<{ id: number }>('transient-value');
            DiContainer.getInstance().register(defineProvider({
                token,
                scope: 'transient',
                useFactory: () => ({ id: ++built })
            }));

            expect(inject(token)).not.toBe(inject(token));
            expect(built).toBe(2);
        });
    });

    describe('synchronous factories', () => {
        it('refuses a factory that declares a parameter, while compiling', () => {
            const token: InjectionToken<string> = new InjectionToken<string>('factory-with-parameter');

            // nothing is ever handed to a sync factory - what it needs, it reaches for with inject()
            // - so a declared parameter would only ever be undefined
            defineProvider({
                token,
                // @ts-expect-error - the factory declares a parameter nothing will pass
                useFactory: (prefix: unknown) => `${String(prefix)}-value`
            });
            DiContainer.getInstance().register(defineProvider({ token, useFactory: () => 'value' }));

            expect(inject(token)).toBe('value');
        });
    });

    describe('providers that name a value', () => {
        it('hands back a value that is null, and goes on doing so', () => {
            const token: InjectionToken<string | null> = new InjectionToken<string | null>('nullable-value');
            // eslint-disable-next-line unicorn/no-null
            DiContainer.getInstance().register(defineProvider({ token, useValue: null }));

            expect(inject(token)).toBeNull();
            expect(inject(token)).toBeNull();
        });

        it('lets a provider registered later replace the value an earlier one named', () => {
            const token: InjectionToken<string | undefined> = new InjectionToken<string | undefined>('replaceable-value');
            DiContainer.getInstance().register(defineProvider({ token, useValue: undefined }));

            // read before the replacement, which is what used to settle it: an injected value was
            // cached under its token, and registering replaces the provider and never the instance -
            // so whichever value was asked for first was the one every later caller got
            expect(inject(token)).toBeUndefined();

            DiContainer.getInstance().register(defineProvider({ token, useValue: 'configured' }));

            expect(inject(token)).toBe('configured');
        });
    });

    describe('resolving', () => {
        // a cycle used to recurse until the stack overflowed, with a trace made of inject frames
        // naming neither class
        it('names a cycle of synchronous providers instead of overflowing the stack', () => {
            class CycleA {}
            class CycleB {}
            // through factories rather than constructor parameters, because two classes referencing
            // each other in one module hit the TDZ on the emitted parameter metadata first
            DiContainer.getInstance().register(defineProvider({
                token: CycleA,
                useFactory: () => {
                    inject(CycleB);
                    return new CycleA();
                }
            }));
            DiContainer.getInstance().register(defineProvider({
                token: CycleB,
                useFactory: () => {
                    inject(CycleA);
                    return new CycleB();
                }
            }));

            expect(() => inject(CycleA)).toThrow(CircularDependencyError);
            expect(() => inject(CycleA)).toThrow(/CycleA/);
        });

        // anything loaded lazily - a plugin, a module required on demand, a path read from
        // configuration - is decorated after the container was initialized
        it('resolves a class decorated after the container was initialized, without blaming the decorator', () => {
            @Injectable()
            class LateInjectable {}

            expect(inject(LateInjectable)).toBeInstanceOf(LateInjectable);
        });
    });
});