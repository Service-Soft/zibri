import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailServiceInterface } from './email-service.interface';
import { CreateEmailData } from './models/create-email-data.model';
import { EmailStatus } from './models/email-status.enum';
import { Email } from './models/email.model';
import { EmailSendResult, EmailTransportInterface } from './transports/email-transport.interface';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// in memory, so that what a mail does across tenants can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

/**
 * The mails the transport was handed, in the order it was handed them.
 */
const sent: Email[] = [];

/**
 * The tenant active while the transport was handed each mail, by subject.
 */
const activeWhileSending: Map<string, string | undefined> = new Map();

const transport: EmailTransportInterface = {
    name: 'RecordingEmailTransport',
    send: async (email: Email): Promise<EmailSendResult> => {
        sent.push(email);
        activeWhileSending.set(email.subject, inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId());
        return await Promise.resolve({ rejectedRecipients: [] });
    }
};

describe('EmailService across tenants', () => {
    const tenantA: string = UUIDUtilities.generate();

    let server: StartedTestServer;
    let emailService: EmailServiceInterface;
    let tenants: TenantServiceInterface;
    let emails: Repository<Email, CreateEmailData>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                    useValue: { maxEmailsPerHour: 1000, defaultSender: 'noreply@example.com', sendLeaseInMs: Ms.MINUTE, sendBatchSize: 10 }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
            ]
        });
        emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        emails = inject(repositoryTokenFor(Email));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('keeps a mail in the tenant it was queued in, and sends the queued mails of every tenant', async () => {
        await tenants.runAs(tenantA, async () => await emailService.queue({
            html: '<p>a</p>',
            subject: 'for a',
            recipients: ['a@example.com'],
            persist: true
        }));
        await emailService.queue({ html: '<p>all</p>', subject: 'for no tenant', recipients: ['all@example.com'], persist: true });

        // from outside every tenant, the way the cron job sends them
        await emailService.sendQueuedEmails();

        // the transport learns the tenant of each mail, eg. to send it from that tenant's address
        expect(sent.map(e => [e.subject, e.tenantId ?? undefined])).toEqual(expect.arrayContaining([
            ['for a', tenantA],
            ['for no tenant', undefined]
        ]));
        const stored: Email[] = await emails.findAll({ acrossTenants: true });
        expect(stored.map(e => [e.subject, e.status])).toEqual(expect.arrayContaining([
            ['for a', EmailStatus.SENT],
            ['for no tenant', EmailStatus.SENT]
        ]));
        expect(stored.find(e => e.subject === 'for a')?.tenantId).toBe(tenantA);
    });

    it('sends each mail in the tenant it was queued in', async () => {
        await tenants.runAs(tenantA, async () => await emailService.queue({
            html: '<p>a</p>',
            subject: 'sent in a',
            recipients: ['a@example.com'],
            persist: false
        }));

        await emailService.sendQueuedEmails();

        // the transport is the application's, and what it does and logs is for the mail's tenant
        expect(activeWhileSending.get('sent in a')).toBe(tenantA);
    });
});