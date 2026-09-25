import { defineProvider, DiProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

import { defaultTestProviders } from '../test-providers';

/**
 * The DI providers a cluster instance boots with unless its options name their own.
 *
 * The single process defaults with the cron and multithreading stubs taken back out. Those two are
 * no-ops for an ordinary test server, and they are exactly the subsystems a cluster test exists to
 * observe - stubbing them would make every such test pass by doing nothing at all.
 */
export const defaultClusterProviders: DiProvider<unknown>[] = [
    ...defaultTestProviders.filter(
        p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE && p.token !== ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE
    ),
    // the real multithreading service, with a pool sized for a machine running several replicas of
    // the same application. maxThreads defaults to what one process alone should take, so N
    // instances ask for N times the machine - and every worker bootstraps a typescript hook before
    // it is of any use, which is what actually costs the time. Booting simultaneously, that overran
    // the harness boot timeout on its own.
    //
    // configured rather than stubbed on purpose: a no-op service would hide whatever the pool does
    // to a replica, which is the kind of thing these tests exist to find.
    defineProvider({
        token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
        useFactory: () => ({
            maxThreads: 1,
            maxPriorityThreads: 1,
            defaultTimeoutMs: Ms.HOUR,
            defaultTimeoutPriorityMs: Ms.MINUTE * 5,
            // short, because a test that takes a replica down should not then wait out a production
            // sized claim to see the work picked up again
            jobClaimInMs: Ms.SECOND * 2,
            enableTsWorkerFiles: true
        })
    })
];