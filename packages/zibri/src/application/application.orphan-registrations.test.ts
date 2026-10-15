import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { MissedLifecycleHooksError } from '../di/errors/missed-lifecycle-hooks.error';
import { inject } from '../di/inject.function';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';

/**
 * What an application that merely imports the package gets, and what it does not.
 *
 * The only suite here that reaches the framework the way a consumer does - through `zibri-testing`,
 * which imports `zibri` by name. Every other suite imports relative paths, which is why nothing
 * caught the controller defect below: the package's own barrel exports both shipped plugins, and
 * importing it is what registers their controllers.
 *
 * The same thing is true one decorator over, and for the same reason. A decorator registers at
 * module load, so a module imported for one of its exports registers every `@Injectable` it
 * declares - and startup used to build every registered token, which meant an application
 * constructed services it had never heard of and ran their lifecycle hooks. What decides it now is
 * whether the class has something to do before its first use, which a hook is the way of saying.
 */

/**
 * What each class recorded about itself, in the order it happened.
 */
const events: string[] = [];

/**
 * A plain service: nothing about it has to happen before something injects it.
 */
@Injectable()
class QuietService {
    constructor() {
        events.push('QuietService constructed');
    }

    /**
     * Proves which instance a caller got.
     * @returns Its own name.
     */
    name(): string {
        return 'QuietService';
    }
}

/**
 * A service that takes part in the lifecycle, which is the case that has to keep working: nothing
 * injects it, and the hook is the reason it is built at all.
 */
@Injectable()
class HookedService {
    constructor() {
        events.push('HookedService constructed');
    }

    /**
     * Records that the application reached it.
     */
    onAppInit(): void {
        events.push('HookedService.onAppInit');
    }
}

/**
 * A service that takes part in the lifecycle and is recorded rather than registered.
 *
 * The shape a package ships for its callers to reach when they want it. Nothing provides it, so
 * initialization has nothing to build and the application says whether it means to run it.
 */
@Injectable({ register: 'onUse' })
class LateService {
    constructor() {
        events.push('LateService constructed');
    }

    /**
     * Records that the application reached it.
     */
    onAppInit(): void {
        events.push('LateService.onAppInit');
    }
}

/**
 * A service recorded rather than registered, which initialization reaches only because another
 * service's constructor asks for it.
 */
@Injectable({ register: 'onUse' })
class JoinedService {
    constructor() {
        events.push('JoinedService constructed');
    }

    /**
     * Records that the application reached it.
     */
    onAppInit(): void {
        events.push('JoinedService.onAppInit');
    }
}

/**
 * A service that takes part in the lifecycle and builds the one above while it is itself built.
 */
@Injectable()
class JoiningService {
    constructor(
        @Inject(JoinedService)
        readonly joined: JoinedService
    ) {}

    /**
     * Takes part in the lifecycle, which is what gets this built at startup.
     */
    onAppInit(): void {
        events.push('JoiningService.onAppInit');
    }
}

/**
 * A service recorded rather than registered, declaring a hook of the first phase.
 */
@Injectable({ register: 'onUse' })
class EarlyService {
    constructor() {
        events.push('EarlyService constructed');
    }

    /**
     * Records that the application reached it.
     */
    beforeAppInit(): void {
        events.push('EarlyService.beforeAppInit');
    }
}

/**
 * Whether {@link ReachingService} reaches for {@link EarlyService}. Off unless a test says so, because
 * the service is registered for every application this file starts.
 */
let reachForEarlyService: boolean = false;

/**
 * A service that reaches for {@link EarlyService} from a hook of a later phase.
 */
@Injectable()
class ReachingService {
    /**
     * Reaches for the service once the phase it declares has finished, and records what it got.
     */
    onAppInit(): void {
        if (!reachForEarlyService) {
            return;
        }
        try {
            inject(EarlyService);
            events.push('EarlyService injected');
        }
        catch (error) {
            events.push(error instanceof Error ? error.name : String(error));
        }
    }
}

/**
 * A service recorded rather than registered, declaring nothing but a shutdown hook.
 */
@Injectable({ register: 'onUse' })
class TeardownService {
    /**
     * Records that the application reached it.
     */
    onAppShutdown(): void {
        events.push('TeardownService.onAppShutdown');
    }
}

/**
 * A controller that asks for the service nothing else wants.
 *
 * Orphan-allowed because only one test declares it, and a controller this file declares is in the
 * registry for every application it starts - an undeclared one that does not allow being an orphan
 * is refused by the router, which is a different rule than the one under test here.
 */
@Controller('/orphans', { allowOrphan: true })
class OrphanUsingController {
    constructor(
        @Inject(QuietService)
        private readonly quiet: QuietService
    ) {}

    /**
     * Names what it was given.
     * @returns The injected service's name.
     */
    @Get('/')
    get(): { quiet: string } {
        return { quiet: this.quiet.name() };
    }
}

@Controller('/orphan-allowed', { allowOrphan: true })
class DeclaredOrphanController {
    @Get('/')
    get(): { ok: boolean } {
        return { ok: true };
    }
}

// one class for the whole file: each call builds a new one, and a data source that is declared and
// never deployed is refused by name - so a second class would fail the *first* test's application
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource();

describe('an application that imports the package', () => {

    let server: StartedTestServer | undefined;

    beforeEach(() => {
        events.length = 0;
        reachForEarlyService = false;
    });

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('starts without declaring the entities of a plugin it does not use', async () => {
        // `import ... from 'zibri'` registers MailingListController, because a decorator registers
        // at module load. Startup then built every registered token, so the controller was
        // constructed and asked for `Repository<MailingListSubscriber>` - a table this application
        // has no reason to carry. The failure was `NoProviderError`, before the first request.
        // the harness's own defaults, deliberately: this is the shape a consumer gets, and the
        // defect below is one only a consumer could hit
        server = await startTestServer({ dataSources: [dataSourceClass] });

        await expect(server.start()).resolves.toMatch(/^http:\/\//);
    }, 15000);

    it('still serves a controller it declares, orphan-allowed or not', async () => {
        // the other half: `allowOrphan` means a controller *may* go unused, not that a declared one
        // is skipped. Without this, the fix above would read as green while quietly unmounting
        // every auth controller - both of the shipped ones are declared exactly this way.
        server = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [DeclaredOrphanController]
        });
        const baseUrl: string = await server.start();

        const res: Response = await fetch(`${baseUrl}/orphan-allowed`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    }, 15000);

    it('builds a service that takes part in the lifecycle, and runs its hook', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        await server.start();

        // asserted first because everything below narrows what gets built, and this is what the
        // narrowing must not reach: a service with a hook and nothing injecting it is the ordinary
        // way to write startup work, and the hook is the whole point of the class.
        expect(events).toContain(`${HookedService.name} constructed`);
        expect(events).toContain(`${HookedService.name}.onAppInit`);
    }, 15000);

    it('does not build a service nothing asks for', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        await server.start();

        // a plain service has nothing that has to happen before something injects it, so building it
        // at startup buys nothing and costs whatever its constructor does. Importing the module that
        // declares it is not a request for it to run.
        expect(events).not.toContain('QuietService constructed');
    }, 15000);

    it('builds it as soon as something injects it', async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [OrphanUsingController]
        });
        const baseUrl: string = await server.start();

        const res: Response = await fetch(`${baseUrl}/orphans`);

        // not built *eagerly* is the claim, not unavailable. It resolves normally for whoever asks.
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ quiet: 'QuietService' });
        expect(events).toContain('QuietService constructed');
    }, 15000);

    it('builds a service the application names, and runs its hook', async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            additionalLifecycleServices: [LateService]
        });
        await server.start();

        // the escape hatch, and the only thing that can serve this case: whether a package's service
        // is meant to run is not something the framework can work out from the class, so naming it is
        // the application saying so.
        expect(events).toContain('LateService constructed');
        expect(events).toContain('LateService.onAppInit');
    }, 15000);

    it('refuses a service first injected after the phases it declares', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        await server.start();

        // the case that has no answer at startup. Nothing provides this class, so leaving it unused
        // is ordinary and building it would be wrong - but somebody asking for it *is* the
        // application wanting it, and by then the hooks it declared have been passed. Silence here
        // would hand back a service whose preparation never happened and that cannot tell.
        expect(() => inject(LateService)).toThrow(MissedLifecycleHooksError);
        expect(() => inject(LateService)).toThrow('additionalLifecycleServices');
        expect(events).not.toContain('LateService constructed');
    }, 15000);

    it('runs the hooks of a service another one builds while the application initializes', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        await server.start();

        // nothing names this class up front, so the list the phases run over could not have held it.
        // It was built before the phase it declares began, which leaves nothing missed - only a hook
        // that has to reach it
        expect(events).toContain('JoinedService constructed');
        expect(events).toContain('JoinedService.onAppInit');
        // and the one whose hook ran is the one everybody gets
        expect(inject(JoiningService).joined).toBe(inject(JoinedService));
    }, 15000);

    it('refuses a service first reached during initialization after a phase it declares', async () => {
        reachForEarlyService = true;
        server = await startTestServer({ dataSources: [dataSourceClass] });

        // reached from a hook of the second phase, and its hook belongs to the first. Keyed on the
        // application being initialized, the refusal waited until the end of all three, so this was
        // built without its hook and nothing said so
        expect(events).toContain(MissedLifecycleHooksError.name);
        expect(events).not.toContain('EarlyService constructed');
    }, 15000);

    it('hands over a service declaring only a shutdown hook after startup, and shuts it down', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        await server.start();

        // nothing it declares is behind the application: shutting down reaches whatever exists by
        // then, so refusing it would only take away a service that works
        expect(() => inject(TeardownService)).not.toThrow();
        await server.shutdown();
        server = undefined;
        expect(events).toContain('TeardownService.onAppShutdown');
    }, 15000);

    it('does not construct anything during shutdown that it never built', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        await server.start();
        events.length = 0;

        await server.shutdown();
        server = undefined;

        // shutting down used to resolve every registered token so it could ask each one to tear
        // itself down, which builds the ones nothing ever used - a constructor running for the first
        // time on the way out, to be handed a shutdown it has no state for. The branch that handles
        // a failed init already argued this and the one below it did the opposite.
        expect(events).not.toContain('QuietService constructed');
    }, 15000);
});