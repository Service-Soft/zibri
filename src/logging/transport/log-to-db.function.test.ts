import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { logToDb } from './log-to-db.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';

describe('logToDb', () => {
    let server: StartedTestServer;
    let logRepository: Repository<Log>;

    beforeAll(async () => {
        server = await startTestServer();
        logRepository = inject(repositoryTokenFor(Log));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('persists the given log to the data source, preserving its id', async () => {
        const log: Log = {
            id: UUIDUtilities.generate(),
            createdAt: new Date(),
            cleanupAt: new Date(Date.now() + 1000),
            message: 'persisted message',
            level: LogLevel.INFO,
            context: { origin: 'origin.ts' }
        };

        await logToDb(log);

        const persisted: Log = await logRepository.findById(log.id);
        expect(persisted.id).toBe(log.id);
        expect(persisted.message).toBe('persisted message');
        expect(persisted.level).toBe(LogLevel.INFO);
        expect(persisted.context.origin).toBe('origin.ts');
    });
});