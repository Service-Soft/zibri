import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailServiceInterface } from './email-service.interface';
import { CreateEmailData } from './models/create-email-data.model';
import { EmailConfigInput } from './models/email-config.model';
import { EmailStatus } from './models/email-status.enum';
import { Email } from './models/email.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { DiProvider, defineProvider } from '../di/models/di-provider.model';
import { LoggerInterface } from '../logging/logger.interface';

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const config: EmailConfigInput = {
    maxEmailsPerHour: 1000,
    defaultSender: 'noreply@example.com',
    failedRetentionInMs: 'forever'
};

/**
 * The test providers without the transport they register, so the application gets the one it
 * provides for itself.
 */
const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders.filter(provider => provider.token !== ZIBRI_DI_TOKENS.EMAIL_TRANSPORT),
    defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: config })
];

/**
 * An application that names no mail server: in development it logs every mail, with the links in
 * it, so a project runs before it has one; in production it does not start. An unset host and port
 * were read as '' and 0, and the application started and failed every mail it sent (08 §X25).
 */
describe('the email transport of an application that provides none', () => {

    describe('in development', () => {
        let server: StartedTestServer;

        beforeAll(async () => {
            server = await startTestServer({ dataSources: [dataSourceClass], providers, environment: 'development' });
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('logs each mail, with what it says, instead of sending it', async () => {
            const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
            const emails: Repository<Email, CreateEmailData> = inject(repositoryTokenFor(Email));
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            const info: jest.SpiedFunction<LoggerInterface['info']> = jest.spyOn(logger, 'info');

            await emailService.queue({
                html: '<a href="https://app.example.com/confirm-password-reset?token=abc">Reset</a>',
                subject: 'Reset your password',
                recipients: ['ada@example.com'],
                persist: true
            });
            await emailService.sendQueuedEmails();

            const logged: string = info.mock.calls.map(call => call[0]).join('\n');
            expect(logged).toContain('Reset your password');
            expect(logged).toContain('ada@example.com');
            expect(logged).toContain('https://app.example.com/confirm-password-reset?token=abc');
            const [row] = await emails.findAll({ where: { subject: 'Reset your password' }, acrossTenants: true });
            expect(row?.status).toBe(EmailStatus.SENT);
        });
    });

    it('does not start in production', async () => {
        await expect(startTestServer({ dataSources: [dataSourceClass], providers, environment: 'production' }))
            .rejects.toThrow(/ZIBRI_DI_TOKENS\.EMAIL_TRANSPORT/);
    }, TestTimeouts.inMemory.start);

    it('does not start in an environment it does not know', async () => {
        // @ts-expect-error -- an application runs in development or in production
        await expect(startTestServer({ dataSources: [dataSourceClass], providers, environment: 'staging' }))
            .rejects.toThrow(/environment/);
    }, TestTimeouts.inMemory.start);
});