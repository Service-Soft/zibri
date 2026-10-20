import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { logToDb } from './log-to-db.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { LogLevel } from '../log-level.enum.ts';
import { Log } from '../log.model.ts';

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

        await logToDb([log]);

        const persisted: Log = await logRepository.findById(log.id);
        expect(persisted.id).toBe(log.id);
        expect(persisted.message).toBe('persisted message');
        expect(persisted.level).toBe(LogLevel.INFO);
        expect(persisted.context.origin).toBe('origin.ts');
    });

    it('persists a whole batch, keeping every id', async () => {
        const logs: Log[] = Array.from({ length: 25 }, (_, i) => ({
            id: UUIDUtilities.generate(),
            createdAt: new Date(),
            cleanupAt: new Date(Date.now() + 1000),
            message: `batched message ${i}`,
            level: LogLevel.INFO,
            context: { origin: 'origin.ts' }
        }));

        await logToDb(logs);

        // one statement rather than twenty five, which is the finding - and the ids have to survive
        // it, because the transport is the only writer that brings its own
        const persisted: Log[] = await Promise.all(logs.map(async l => await logRepository.findById(l.id)));
        expect(persisted.map(p => p.message)).toEqual(logs.map(l => l.message));
    });
});