import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailCleanupCronJob } from './email-cleanup.cron-job';
import { CreateEmailData } from './models/create-email-data.model';
import { EmailConfigInput } from './models/email-config.model';
import { EmailPriority } from './models/email-priority.enum';
import { EmailStatus } from './models/email-status.enum';
import { Email } from './models/email.model';
import { EmailSendResult, EmailTransportInterface } from './transports/email-transport.interface';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronJobEntity, CreateCronJobEntityData } from '../cron/cron-job-entity.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { RetentionInMs } from '../types/retention-in-ms.type';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// in memory, so that what the cleanup leaves behind can be read without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const transport: EmailTransportInterface = {
    name: 'UnusedEmailTransport',
    send: async (): Promise<EmailSendResult> => await Promise.resolve({ rejectedRecipients: [] })
};

/**
 * Starts a server whose failed mails are kept for the given time.
 * @param failedRetentionInMs - How long a failed mail is kept.
 * @returns The server.
 */
async function startWith(failedRetentionInMs: RetentionInMs): Promise<StartedTestServer> {
    const config: EmailConfigInput = { maxEmailsPerHour: 1000, defaultSender: 'noreply@example.com', failedRetentionInMs };
    return await startTestServer({
        dataSources: [dataSourceClass],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: config }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
        ]
    });
}

/**
 * Stores a mail of the given status, queued the given time ago.
 * @param status - Its status.
 * @param ageInMs - How long ago it was queued.
 * @param tenantId - The tenant it was queued in, if any.
 * @returns The mail.
 */
async function store(status: EmailStatus, ageInMs: number, tenantId?: string): Promise<Email> {
    const emails: Repository<Email, CreateEmailData> = inject(repositoryTokenFor(Email));
    const create: () => Promise<Email> = async () => await emails.create({
        status,
        priority: EmailPriority.NORMAL,
        persist: true,
        sender: 'noreply@example.com',
        recipients: ['someone@example.com'],
        subject: `${status} ${ageInMs}`,
        html: '<p>hi</p>'
    });
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    const email: Email = tenantId == undefined ? await create() : await tenants.runAs(tenantId, create);
    await emails.updateById(email.id, { createdAt: new Date(Date.now() - ageInMs) }, { acrossTenants: true });
    return email;
}

/**
 * Whether a mail is still stored.
 * @param email - The mail.
 * @returns Whether it is.
 */
async function isStored(email: Email): Promise<boolean> {
    const emails: Repository<Email, CreateEmailData> = inject(repositoryTokenFor(Email));
    return await emails.count({ where: { id: email.id }, acrossTenants: true }) === 1;
}

/**
 * Runs the cleanup job once, built by hand, because the test server runs no cron jobs.
 */
async function runCleanup(): Promise<void> {
    const cleanup: EmailCleanupCronJob = new EmailCleanupCronJob(inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE));
    const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
    await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
    await cleanup.onTick();
}

describe('EmailCleanupCronJob, keeping failed mails for a day', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startWith(Ms.DAY);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('deletes the failed mails of every tenant older than failedRetentionInMs, and keeps every other mail', async () => {
        const expired: Email = await store(EmailStatus.FAILED, 2 * Ms.DAY);
        const expiredInTenant: Email = await store(EmailStatus.FAILED, 2 * Ms.DAY, UUIDUtilities.generate());
        const recent: Email = await store(EmailStatus.FAILED, Ms.HOUR);
        // kept because the application asked for it with persist, however old
        const oldSent: Email = await store(EmailStatus.SENT, 2 * Ms.DAY);
        const oldQueued: Email = await store(EmailStatus.QUEUED, 2 * Ms.DAY);

        await runCleanup();

        expect(await isStored(expired)).toBe(false);
        expect(await isStored(expiredInTenant)).toBe(false);
        expect(await isStored(recent)).toBe(true);
        expect(await isStored(oldSent)).toBe(true);
        expect(await isStored(oldQueued)).toBe(true);
    });
});

describe('EmailCleanupCronJob, keeping failed mails forever', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startWith('forever');
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('keeps every failed mail, however old', async () => {
        const old: Email = await store(EmailStatus.FAILED, 365 * Ms.DAY);

        await runCleanup();

        expect(await isStored(old)).toBe(true);
    });
});