import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EventCleanupCronJob } from './event-cleanup.cron-job';
import { type EventServiceInterface, EventSubscriptionInterface } from './event-service.interface';
import { EventSubscriberRegistration, EventSubscriberRegistrationCreateData } from './event-subscriber-registration.model';
import { EventSubscriberRun } from './event-subscriber-run.model';
import { Event, EventStatus } from './event.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { CronJobEntity, CreateCronJobEntityData } from '../cron/cron-job-entity.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

declare module './event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'tenancy.emitted': Record<string, number>,
        'tenancy.polled': Record<string, number>
    }
}

// in memory, so that what an event does across tenants can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

describe('EventService across tenants', () => {
    const tenantA: string = UUIDUtilities.generate();
    const tenantB: string = UUIDUtilities.generate();

    let server: StartedTestServer;
    let eventService: EventServiceInterface;
    let tenants: TenantServiceInterface;
    let eventRepo: Repository<Event<unknown>>;
    let runRepo: Repository<EventSubscriberRun<unknown>>;
    let registrationRepo: Repository<EventSubscriberRegistration, EventSubscriberRegistrationCreateData>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        eventRepo = inject(repositoryTokenFor(Event));
        runRepo = inject(repositoryTokenFor(EventSubscriberRun));
        registrationRepo = inject(repositoryTokenFor(EventSubscriberRegistration));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    // for the reason event.service.test.ts gives: a registration outlives its subscription
    beforeEach(async () => {
        await registrationRepo.deleteAll({});
    });

    it('keeps an event in the tenant it was emitted in, and runs its hooks there', async () => {
        const seen: (string | undefined)[] = [];
        const sub: EventSubscriptionInterface = await eventService.subscribe(
            'tenancy.emitted',
            () => {
                seen.push(tenants.getActiveTenantId());
            },
            { subscriberId: 'tenancy-emitted' }
        );

        await tenants.runAs(tenantA, async () => await eventService.emit('tenancy.emitted', { n: 1 }));
        await eventService.emit('tenancy.emitted', { n: 2 });
        await waitUntil(() => seen.length === 2);
        expect(seen).toEqual(expect.arrayContaining([tenantA, undefined]));

        const findEvents: () => Promise<Event<unknown>[]> = async () => await eventRepo.findAll({
            where: { type: 'tenancy.emitted' },
            acrossTenants: true
        });
        await waitUntil(async () => (await findEvents()).every(e => e.status === EventStatus.FINISHED));
        const events: Event<unknown>[] = await findEvents();
        expect(events.map(e => e.tenantId ?? undefined)).toEqual(expect.arrayContaining([tenantA, undefined]));

        // each run belongs to the tenant of its event
        const runs: EventSubscriberRun<unknown>[] = await runRepo.findAll({
            where: { eventId: { oneOf: events.map(e => e.id) } },
            acrossTenants: true
        });
        expect(runs).toHaveLength(2);
        for (const run of runs) {
            expect(run.tenantId ?? undefined).toBe(events.find(e => e.id === run.eventId)?.tenantId ?? undefined);
        }

        // another tenant sees neither the event nor its run
        await tenants.runAs(tenantB, async () => {
            expect((await eventRepo.findAll({ where: { type: 'tenancy.emitted' } })).map(e => e.tenantId ?? undefined)).toEqual([undefined]);
        });
        sub.unsubscribe();
    });

    it('dispatches what every tenant still owes from the poll, each in its own tenant', async () => {
        const seen: (string | undefined)[] = [];
        const sub: EventSubscriptionInterface = await eventService.subscribe(
            'tenancy.polled',
            () => {
                seen.push(tenants.getActiveTenantId());
            },
            { subscriberId: 'tenancy-polled' }
        );
        // what an instance that went away left behind: stored and owed, and never handed to a hook
        const left: Event<unknown> = await tenants.runAs(tenantB, async () => await eventRepo.create({
            type: 'tenancy.polled',
            subscriberIds: ['tenancy-polled'],
            cleanupAt: new Date(Date.now() + Ms.DAY),
            data: { n: 1 }
        }));

        // outside every tenant, the way the dispatch cron job runs it
        await eventService.dispatchPending();
        await waitUntil(() => seen.length === 1);
        expect(seen).toEqual([tenantB]);
        await waitUntil(async () => (await eventRepo.findById(left.id, { acrossTenants: true })).status === EventStatus.FINISHED);
        sub.unsubscribe();
    });

    it('cleans up the finished events of every tenant', async () => {
        const finished: Event<unknown> = await tenants.runAs(tenantA, async () => await eventRepo.create({
            type: 'tenancy.finished',
            subscriberIds: [],
            cleanupAt: new Date(Date.now() - Ms.SECOND),
            data: {}
        }));
        await eventRepo.updateById(finished.id, { status: EventStatus.FINISHED }, { acrossTenants: true });

        // built by hand, because the test server runs no cron jobs
        const cleanup: EventCleanupCronJob = new EventCleanupCronJob(eventRepo);
        const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
        await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
        await cleanup.onTick();

        expect(await eventRepo.count({ where: { id: finished.id }, acrossTenants: true })).toBe(0);
    });
});