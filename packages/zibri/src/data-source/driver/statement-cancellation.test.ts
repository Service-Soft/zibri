import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Repository } from '../repository/repository.ts';
import { Transaction } from '../transaction/transaction.model.ts';

/**
 * What the handler recorded about the one statement it issued.
 */
type StatementRecord = {
    /**
     * How long the statement was on the wire before it came back, one way or the other.
     */
    tookMs: number,
    /**
     * Whether it came back at all rather than the handler still waiting.
     */
    ended: boolean
};

let statement: StatementRecord | undefined;
let lockedUserId: string = '';

/**
 * What the handler recorded, read through a function so the narrowing of a module level `let` does
 * not make it look like it can only be what this file last wrote.
 * @returns The record, or undefined while the handler is still waiting.
 */
function readStatement(): StatementRecord | undefined {
    return statement;
}

/**
 * How long the lock is held after the deadline has passed.
 *
 * Long enough that a statement coming back inside it cannot be explained by the lock being released
 * - which is the only other way it could end.
 */
const HOLD_MS: number = 6000;

@Controller('/cancel')
class CancelController {
    @Get('/blocked-write', { timeoutInMs: 300 })
    async blockedWrite(): Promise<{ ok: boolean }> {
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const startedAt: number = Date.now();
        try {
            // the row is held by an open transaction, so the store makes this statement wait for it.
            // A write rather than a read, because a read is never blocked by a row lock
            await users.updateAll({ id: lockedUserId }, { email: 'written@example.com' });
            statement = { tookMs: Date.now() - startedAt, ended: true };
            return { ok: true };
        }
        catch {
            statement = { tookMs: Date.now() - startedAt, ended: true };
            throw new Error('the write did not go through');
        }
    }
}

const dataSourceClass: ReturnType<typeof createTestDataSource> = createTestDataSource();

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        controllers: [CancelController],
        dataSources: [dataSourceClass]
    });
    baseUrl = await server.start();

    const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
    const user: JwtUser = await users.create({ email: 'locked@example.com', roles: [] });
    lockedUserId = user.id;
}, 120000);

afterAll(async () => {
    await server?.shutdown();
}, 60000);

describe('a statement whose request runs out of time', () => {

    it('is stopped where it runs rather than waited out', async () => {
        statement = undefined;
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));

        // an open transaction that has written the row holds a lock on it until it ends, which is
        // how a statement is made to take a known, long time without asking the store to sleep
        const holder: Transaction = await inject(dataSourceClass).startTransaction();
        await users.updateAll({ id: lockedUserId }, { email: 'held@example.com' }, { transaction: holder });

        try {
            const res: Response = await fetch(`${baseUrl}/cancel/blocked-write`);
            expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

            // well inside the lock's own lifetime, so a statement that has ended by now ended
            // because it was stopped rather than because the row became free
            await new Promise<void>(resolve => {
                setTimeout(resolve, 2000).unref();
            });

            // the deadline is 300ms and the lock is held for six seconds. Without the cancel the
            // handler is still queued behind that lock, holding a connection for a caller that was
            // answered five seconds ago
            // read through the accessor so that the assignment inside the handler is what decides
            // the type here, rather than the `undefined` this test set on its way in
            const recorded: StatementRecord | undefined = readStatement();
            if (!recorded) {
                throw new Error('the handler recorded nothing, so its statement never came back');
            }
            expect(recorded.ended).toBe(true);
            expect(recorded.tookMs).toBeLessThan(HOLD_MS);
        }
        finally {
            await new Promise<void>(resolve => {
                setTimeout(resolve, HOLD_MS).unref();
            });
            await holder.rollback();
        }
    }, 60000);
});