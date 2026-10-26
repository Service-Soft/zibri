import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { PasswordResetTokenCleanupCronJob } from './password-reset-token-cleanup.cron-job';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { CronService } from '../../../cron/cron.service';
import { CronServiceInterface } from '../../../cron/cron-service.interface';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { DiProvider, defineProvider } from '../../../di/models/di-provider.model';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { $ts } from '../../../localization/translate.function';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { AuthenticatorInterface } from '../authenticator.interface';

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * The test providers with the real cron service, rather than the stub that registers nothing: that the
 * application registers the job is part of what is tested.
 */
const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders.filter(provider => provider.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
];

/**
 * An authenticator that is not the password one, so an application listing only it has no reset tokens.
 */
class TokenOnlyAuthenticator implements AuthenticatorInterface<string, BaseUser<string>, unknown> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'token-only';

    // eslint-disable-next-line jsdoc/require-jsdoc
    authenticate(_credentials: unknown, _transaction: Transaction | undefined): Promise<Authentication<BaseUser<string>>> {
        return Promise.reject(new UnauthorizedError($ts`Nobody logs in here.`));
    }
}

/**
 * Whether the running application registered the job.
 * @returns True when the cron service holds it.
 */
function isRegistered(): boolean {
    return inject<CronServiceInterface>(ZIBRI_DI_TOKENS.CRON_SERVICE).cronJobs.some(job => job instanceof PasswordResetTokenCleanupCronJob);
}

/**
 * An expired, unused reset token was kept for good: nothing deleted it but the next reset its user
 * asked for (08 §X27).
 */
describe('PasswordResetTokenCleanupCronJob', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass], providers });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('is registered for an application that logs in with a password', () => {
        expect(isRegistered()).toBe(true);
    });

    it('deletes the reset tokens that expired, and keeps the ones that did not', async () => {
        const tokens: Repository<PasswordResetToken, PasswordResetTokenCreateData> = inject(repositoryTokenFor(PasswordResetToken));
        const expired: PasswordResetToken = await tokens.create({
            userId: UUIDUtilities.generate(),
            value: UUIDUtilities.generate(),
            expirationDate: new Date(Date.now() - Ms.MINUTE)
        });
        const current: PasswordResetToken = await tokens.create({
            userId: UUIDUtilities.generate(),
            value: UUIDUtilities.generate(),
            expirationDate: new Date(Date.now() + Ms.HOUR)
        });

        await inject(PasswordResetTokenCleanupCronJob).onTick();

        const left: string[] = (await tokens.findAll({ where: { id: { oneOf: [expired.id, current.id] } } })).map(token => token.id);
        expect(left).toEqual([current.id]);
    });
});

describe('PasswordResetTokenCleanupCronJob, for an application that does not log in with a password', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass], providers, authenticators: [TokenOnlyAuthenticator] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('is not registered', () => {
        expect(isRegistered()).toBe(false);
    });
});

// the harness's reInit inherited the options of the running application, cron jobs the framework
// added while it started included, so a job a feature registered outlived the feature
describe('PasswordResetTokenCleanupCronJob, after a reInit without the password authenticator', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass], providers });
        await server.reInit({ authenticators: [TokenOnlyAuthenticator] });
    }, TestTimeouts.inMemory.start * 2);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('is not registered', () => {
        expect(isRegistered()).toBe(false);
    });
});
