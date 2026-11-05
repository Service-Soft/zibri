import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { type EventServiceInterface } from './event-service.interface';
import { EventSubscriberRegistration } from './event-subscriber-registration.model';
import { Event, EventCreateData } from './event.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';

/**
 * What one pass of the dispatch poll costs, as calls on the store.
 */

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    roundTrips
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describe('what the event dispatch poll costs', () => {
    it('reads a page of fifty due events with a constant number of calls, not two more per event', async () => {
        // a subscriber hosted by another instance: on record, so every event below is owed to it,
        // and not on this one, so offering the events here starts nothing
        const registrations: Repository<EventSubscriberRegistration> = inject(repositoryTokenFor(EventSubscriberRegistration));
        await registrations.create({
            subscriberId: 'elsewhere',
            eventType: 'costs.test',
            expiresAt: new Date(Date.now() + Ms.HOUR)
        });
        const events: Repository<Event<unknown>, EventCreateData<unknown>> = inject(repositoryTokenFor(Event));
        for (let i: number = 0; i < 50; i++) {
            await events.create({
                type: 'costs.test',
                data: { i },
                cleanupAt: new Date(Date.now() + Ms.DAY),
                subscriberIds: ['elsewhere']
            });
        }
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);

        await roundTrips.resolveCountOf(async () => await eventService.dispatchPending());

        // the events with their runs, and the registrations of the types on the page
        expect(roundTrips.count).toBeLessThanOrEqual(3);
    });
});