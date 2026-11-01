import { afterEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { validateEntitiesRegistered } from './validate-entities-registered.function';
import { TestTimeouts } from '../__testing__/constants';
import { missingEntityPattern } from '../__testing__/missing-entity-pattern.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZibriApplication } from '../application/application';
import { HashStrategyEntity } from '../auth/hash/strategies/hash-strategy-entity.model';
import { Email } from '../email/models/email.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { MissingEntitiesError } from '../error-handling/errors/missing-entities.error';
import { AppState } from '../global/app-state.enum';
import { GlobalRegistry } from '../global/global-registry';
import { Lease } from '../leases/lease.model';
import { ZibriPlugin } from '../plugin/plugin.model';

@Entity({ tenant: 'shared', allowOrphan: true })
class UnregisteredScratchEntity extends BaseEntity {}

class ScratchValidatePlugin extends ZibriPlugin {
    constructor(private readonly pluginName: string) {
        super();
    }

    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.pluginName, app, UnregisteredScratchEntity);
    }
}

/**
 * Keeps the application it validates, for a case that validates once the application runs.
 */
class KeepingAppPlugin extends ZibriPlugin {
    app: ZibriApplication | undefined;

    validate(app: ZibriApplication): void {
        this.app = app;
    }
}

describe('validateEntitiesRegistered', () => {
    afterEach(() => {
        GlobalRegistry['appData'].state = AppState.OFFLINE;
    });

    // after-all-findings-fixed W2: each part refused the boot on its own, so an application learned the
    // entities it lacks one start at a time
    it('refuses a boot once for every entity no data source declares, each with everything that requires it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([Lease, Email, HashStrategyEntity], {
            plugins: [new ScratchValidatePlugin('FirstPlugin'), new ScratchValidatePlugin('SecondPlugin'), new ScratchValidatePlugin('ThirdPlugin')]
        });

        const error: unknown = await start.catch((e: unknown) => e);
        expect(error).toBeInstanceOf(MissingEntitiesError);
        const message: string = error instanceof Error ? error.message : '';
        expect(message).toMatch(missingEntityPattern('Lease', 'LeaseService'));
        expect(message).toMatch(missingEntityPattern('Email', 'EmailService'));
        // the hash service reads its table right after asking for it, which fails with the table
        // missing - and the boot still goes on to say what everything after it needs
        expect(message).toMatch(missingEntityPattern('HashStrategyEntity', 'HashService'));
        expect(message).toContain('- UnregisteredScratchEntity (required by FirstPlugin, SecondPlugin and ThirdPlugin)');
    }, TestTimeouts.inMemory.start);

    it('refuses at once once the application is up', async () => {
        const plugin: KeepingAppPlugin = new KeepingAppPlugin();
        const server: StartedTestServer = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            plugins: [plugin]
        });
        try {
            const app: ZibriApplication | undefined = plugin.app;
            expect(app).toBeDefined();
            expect(() => app != undefined && validateEntitiesRegistered('LateReader', app, UnregisteredScratchEntity))
                .toThrow(missingEntityPattern('UnregisteredScratchEntity', 'LateReader'));
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});
