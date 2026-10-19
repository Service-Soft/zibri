import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MailingListServiceInterface, MailingListSubscriberCreateData } from './mailing-list-service.interface';
import { MailingListService } from './mailing-list.service';
import { compileTsxTemplate } from '../../../__testing__/compile-tsx-template.function';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { Email } from '../../../email/models/email.model';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { MailingListConfirmationTokenCleanupCronJob } from '../mailing-list-confirmation-token-cleanup.cron-job';
import { ZibriMailingListPlugin } from '../mailing-list.plugin';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from '../mailing-list.tokens';
import { MailingListBaseEmailTemplate } from '../models/mailing-list-base-email-template.model';
import { MailingListSubscribeConfirmationEmailTemplate } from '../models/mailing-list-subscribe-confirmation-email-template.model';
import { MailingListSubscriber } from '../models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from '../models/mailing-list-subscription-confirmation-token.model';
import { MailingList } from '../models/mailing-list.model';

const baseEmailTemplate: MailingListBaseEmailTemplate = compileTsxTemplate<MailingListBaseEmailTemplate>(
    'export const Email = ({ title }) => <div>{title}</div>;'
);
const subscribeConfirmationEmailTemplate: MailingListSubscribeConfirmationEmailTemplate
    = compileTsxTemplate<MailingListSubscribeConfirmationEmailTemplate>(
        'export const Email = ({ confirmEmailLink }) => <a href={confirmEmailLink}></a>;'
    );

/**
 * The tenant the mailing lists of the tests belong to.
 */
const TENANT: string = UUIDUtilities.generate();

/**
 * Runs the given work in the tenant of the tests.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TENANT, fn);
}

/**
 * The token the confirmation link of a mail carries: the only place it exists in the clear, since
 * the stored row holds it hashed.
 * @param mail - The confirmation mail.
 * @returns The token.
 * @throws When the mail carries no confirmation link.
 */
function tokenFromMail(mail: Email | undefined): string {
    const token: string | undefined = /\/subscribe\/([^"?]+)/.exec(mail?.html ?? '')?.[1];
    if (token == undefined) {
        throw new Error('The mail carries no confirmation link.');
    }
    return token;
}

// first, for the reason on startAndStopTestServerWithout
describe('ZibriMailingListPlugin — starting', () => {
    it('refuses to start without its entities, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            plugins: [new ZibriMailingListPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE, useValue: baseEmailTemplate }),
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,
                    useValue: subscribeConfirmationEmailTemplate
                })
            ]
        });

        await expect(start).rejects.toThrow(
            /Error initializing ZibriMailingListPlugin[\S\s]*- MailingList\n[\S\s]*- MailingListSubscriber\n[\S\s]*- MailingListSubscriptionConfirmationToken/
        );
    }, 30000);
});

describe('MailingListService', () => {
    let server: StartedTestServer;
    let service: MailingListServiceInterface;
    let mailingListRepository: Repository<MailingList>;
    let subscriberRepository: Repository<MailingListSubscriber>;
    let confirmationTokenRepository: Repository<
        MailingListSubscriptionConfirmationToken,
        MailingListSubscriptionConfirmationTokenCreateData
    >;
    let emailRepository: Repository<Email>;

    beforeAll(async () => {
        server = await startTestServer({
            plugins: [new ZibriMailingListPlugin()],
            dataSources: [
                createTestDataSource({
                    entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken]
                })
            ],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE, useValue: baseEmailTemplate }),
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,
                    useValue: subscribeConfirmationEmailTemplate
                })
            ]
        });
        service = inject(MailingListService);
        mailingListRepository = inject(repositoryTokenFor(MailingList));
        subscriberRepository = inject(repositoryTokenFor(MailingListSubscriber));
        confirmationTokenRepository = inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));
        emailRepository = inject(repositoryTokenFor(Email));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    async function createMailingList(name: string): Promise<MailingList> {
        return mailingListRepository.create({ name, subscribers: [] });
    }

    describe('resolveSubscribeConfirmationLink / resolveUnsubscribeLink / resolveManagePreferencesLink', () => {
        it('builds the expected urls, naming the tenant and carrying the subscriber\'s secret', async () => await inTenant(async () => {
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email: 'links@example.com', mailingLists: [] });
            const query: string = `subscriberId=${subscriber.id}&secret=${subscriber.secret}`;

            expect(await service.resolveSubscribeConfirmationLink('list1', 'tok'))
                .toBe(`http://localhost:3000/mailing-lists/list1/subscribe/tok?x-tenant-id=${TENANT}`);
            expect(await service.resolveUnsubscribeLink('list1', subscriber))
                .toBe(`http://localhost:3000/mailing-lists/list1/unsubscribe?${query}&x-tenant-id=${TENANT}`);
            expect(await service.resolveManagePreferencesLink(subscriber))
                .toBe(`http://localhost:3000/mailing-lists/preferences?${query}&x-tenant-id=${TENANT}`);
        }));

        it('refuses to build one outside every tenant, which the mailing lists belong to', async () => {
            const subscriber: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.create({ email: 'links-outside@example.com', mailingLists: [] })
            );
            await expect(service.resolveManagePreferencesLink(subscriber)).rejects.toThrow(NoActiveTenantError);
        });
    });

    describe('resolveSubscriberOfLink', () => {
        it('gives every subscriber a secret of their own, stored encrypted', async () => await inTenant(async () => {
            const first: MailingListSubscriber = await subscriberRepository.create({ email: 'secret-a@example.com', mailingLists: [] });
            const second: MailingListSubscriber = await subscriberRepository.create({ email: 'secret-b@example.com', mailingLists: [] });

            expect(first.secret.length).toBeGreaterThanOrEqual(32);
            expect(first.secret).not.toBe(second.secret);
            const stored: MailingListSubscriber = await subscriberRepository.findById(first.id, { autoDecrypt: false });
            expect(stored.secret).not.toContain(first.secret);
        }));

        it('answers with the subscriber, and the lists they are on, for their id and their secret', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('link-subscriber');
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email: 'link-subscriber@example.com', mailingLists: [list] });

            const found: MailingListSubscriber = await service.resolveSubscriberOfLink(subscriber.id, subscriber.secret);

            expect(found.id).toBe(subscriber.id);
            expect(found.mailingLists.map(l => l.id)).toEqual([list.id]);
        }));

        it('refuses a secret that is not the subscriber\'s, and an id that is no subscriber\'s alike', async () => await inTenant(async () => {
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email: 'link-wrong@example.com', mailingLists: [] });
            const other: MailingListSubscriber = await subscriberRepository.create({ email: 'link-other@example.com', mailingLists: [] });

            await expect(service.resolveSubscriberOfLink(subscriber.id, other.secret)).rejects.toThrow(UnauthorizedError);
            await expect(service.resolveSubscriberOfLink(subscriber.id, '')).rejects.toThrow(UnauthorizedError);
            await expect(service.resolveSubscriberOfLink(UUIDUtilities.generate(), subscriber.secret)).rejects.toThrow(UnauthorizedError);
        }));
    });

    describe('requestSubscribeToList', () => {
        it('creates a confirmation token and queues a confirmation email for a brand new subscriber', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('list-new-subscriber');
            const email: string = 'new-subscriber@example.com';

            await service.requestSubscribeToList(
                list.id,
                { email, name: 'New Subscriber' } as MailingListSubscriberCreateData,
                { subject: 'Please confirm' }
            );

            const tokens: MailingListSubscriptionConfirmationToken[] = await confirmationTokenRepository.findAll({ where: { email } });
            expect(tokens.length).toBe(1);
            expect(tokens[0]?.listId).toBe(list.id);

            const emails: Email[] = await emailRepository.findAll({ where: { recipients: { includes: [email] } } });
            expect(emails.length).toBe(1);
            expect(emails[0]?.subject).toBe('Please confirm');

            const subscribers: MailingListSubscriber[] = await subscriberRepository.findAll({ where: { email } });
            expect(subscribers.length).toBe(0);
        }));

        it('asks an address already on another list to confirm as well, and adds nothing before it does', async () => await inTenant(async () => {
            const listA: MailingList = await createMailingList('list-existing-a');
            const listB: MailingList = await createMailingList('list-existing-b');
            const email: string = 'existing-subscriber@example.com';

            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email, mailingLists: [listA] });

            await service.requestSubscribeToList(listB.id, { email } as MailingListSubscriberCreateData, { subject: 'Confirm list b' });

            const updated: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(updated.mailingLists.map(l => l.id)).toEqual([listA.id]);

            const tokens: MailingListSubscriptionConfirmationToken[] = await confirmationTokenRepository.findAll({ where: { email } });
            expect(tokens.length).toBe(1);
            const emails: Email[] = await emailRepository.findAll({ where: { subject: 'Confirm list b' } });
            expect(emails.map(e => e.recipients)).toEqual([[email]]);

            await service.confirmSubscribeToList(listB.id, tokenFromMail(emails[0]));
            const confirmed: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(confirmed.mailingLists.map(l => l.id).sort()).toEqual([listA.id, listB.id].sort());
        }));

        it('sends nothing to an address already on the list', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('list-already-on');
            const email: string = 'already-on@example.com';
            await subscriberRepository.create({ email, mailingLists: [list] });

            await service.requestSubscribeToList(list.id, { email } as MailingListSubscriberCreateData, { subject: 'Confirm already on' });

            expect(await confirmationTokenRepository.findAll({ where: { email } })).toEqual([]);
            expect(await emailRepository.findAll({ where: { subject: 'Confirm already on' } })).toEqual([]);
        }));

        it('stores the token hashed, so the stored value is not what the link carries', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('list-hashed');
            const email: string = 'hashed@example.com';

            await service.requestSubscribeToList(list.id, { email } as MailingListSubscriberCreateData, { subject: 'Confirm hashed' });

            const [mail] = await emailRepository.findAll({ where: { subject: 'Confirm hashed' } });
            const [stored] = await confirmationTokenRepository.findAll({ where: { email } });
            expect(stored?.value).not.toContain(tokenFromMail(mail));
        }));

        it('keeps no copy of the mail, whose link confirms the subscription', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('list-persist');

            await service.requestSubscribeToList(
                list.id,
                { email: 'persist@example.com' } as MailingListSubscriberCreateData,
                { subject: 'Confirm persist', persist: true }
            );

            const emails: Email[] = await emailRepository.findAll({ where: { subject: 'Confirm persist' } });
            expect(emails.map(e => e.persist)).toEqual([false]);
        }));
    });

    describe('confirmSubscribeToList', () => {
        /**
         * Creates a confirmation token the way a request for a subscription does.
         * @param listId - The list it confirms a subscription to.
         * @param email - The address it subscribes.
         * @param expiresInMs - How long it is accepted for.
         * @returns The token as the link carries it, which the stored row only holds hashed.
         */
        async function createToken(listId: string, email: string, expiresInMs: number = 60_000): Promise<string> {
            const value: string = `token-${email}-${listId}-${Date.now()}`;
            await confirmationTokenRepository.create({
                email,
                value,
                expirationDate: new Date(Date.now() + expiresInMs),
                listId,
                name: undefined,
                spent: false
            });
            return value;
        }

        it('creates a new subscriber when none exists yet', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('confirm-new');
            const email: string = 'confirm-new@example.com';
            const token: string = await createToken(list.id, email);

            const subscriber: MailingListSubscriber = await service.confirmSubscribeToList(list.id, token);

            expect(subscriber.email).toBe(email);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists.map(l => l.id)).toEqual([list.id]);
        }));

        it('attaches the list to an already existing subscriber', async () => await inTenant(async () => {
            const listA: MailingList = await createMailingList('confirm-existing-a');
            const listB: MailingList = await createMailingList('confirm-existing-b');
            const email: string = 'confirm-existing@example.com';
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email, mailingLists: [listA] });
            const token: string = await createToken(listB.id, email);

            const result: MailingListSubscriber = await service.confirmSubscribeToList(listB.id, token);

            expect(result.id).toBe(subscriber.id);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists.map(l => l.id).sort()).toEqual([listA.id, listB.id].sort());
        }));

        it('is idempotent when the subscriber is already subscribed to the list', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('confirm-idempotent');
            const email: string = 'confirm-idempotent@example.com';
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email, mailingLists: [list] });
            const token: string = await createToken(list.id, email);

            const result: MailingListSubscriber = await service.confirmSubscribeToList(list.id, token);

            expect(result.id).toBe(subscriber.id);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists.map(l => l.id)).toEqual([list.id]);
        }));

        it('refuses a token that expired', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('confirm-expired');
            const email: string = 'confirm-expired@example.com';
            const token: string = await createToken(list.id, email, -1);

            await expect(service.confirmSubscribeToList(list.id, token)).rejects.toThrow(UnauthorizedError);
            expect(await subscriberRepository.findAll({ where: { email } })).toEqual([]);
        }));

        it('refuses a token for another list than the one the link names', async () => await inTenant(async () => {
            const listA: MailingList = await createMailingList('confirm-other-a');
            const listB: MailingList = await createMailingList('confirm-other-b');
            const email: string = 'confirm-other@example.com';
            const token: string = await createToken(listA.id, email);

            await expect(service.confirmSubscribeToList(listB.id, token)).rejects.toThrow(UnauthorizedError);
            expect(await subscriberRepository.findAll({ where: { email } })).toEqual([]);
        }));

        it('subscribes no one again with a token that was used, once its address left the list', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('confirm-used');
            const email: string = 'confirm-used@example.com';
            const token: string = await createToken(list.id, email);
            const subscriber: MailingListSubscriber = await service.confirmSubscribeToList(list.id, token);
            await service.unsubscribeFromList(list.id, subscriber.id);

            await expect(service.confirmSubscribeToList(list.id, token)).rejects.toThrow(UnauthorizedError);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists).toEqual([]);
        }));

        it('answers a token that was used with its subscriber while the address is still on the list', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('confirm-used-again');
            const email: string = 'confirm-used-again@example.com';
            const token: string = await createToken(list.id, email);
            const subscriber: MailingListSubscriber = await service.confirmSubscribeToList(list.id, token);

            const again: MailingListSubscriber = await service.confirmSubscribeToList(list.id, token);

            expect(again.id).toBe(subscriber.id);
            expect(await subscriberRepository.findAll({ where: { email } })).toHaveLength(1);
        }));

        it('subscribes an address once when its link is followed twice at the same time', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('confirm-concurrent');
            const email: string = 'confirm-concurrent@example.com';
            const token: string = await createToken(list.id, email);

            await Promise.allSettled([service.confirmSubscribeToList(list.id, token), service.confirmSubscribeToList(list.id, token)]);

            expect(await subscriberRepository.findAll({ where: { email } })).toHaveLength(1);
        }));
    });

    describe('MailingListConfirmationTokenCleanupCronJob', () => {
        it('deletes the tokens that expired in every tenant, and keeps the others', async () => {
            const otherTenant: string = UUIDUtilities.generate();
            const expiredHere: MailingListSubscriptionConfirmationToken = await inTenant(async () => await confirmationTokenRepository.create(
                { email: 'cleanup-a@example.com', value: 'cleanup-a', expirationDate: new Date(Date.now() - 1), listId: UUIDUtilities.generate(), spent: false }
            ));
            const expiredThere: MailingListSubscriptionConfirmationToken = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
                otherTenant,
                async () => await confirmationTokenRepository.create(
                    { email: 'cleanup-b@example.com', value: 'cleanup-b', expirationDate: new Date(Date.now() - 1), listId: UUIDUtilities.generate(), spent: true }
                )
            );
            const live: MailingListSubscriptionConfirmationToken = await inTenant(async () => await confirmationTokenRepository.create(
                { email: 'cleanup-c@example.com', value: 'cleanup-c', expirationDate: new Date(Date.now() + 60_000), listId: UUIDUtilities.generate(), spent: false }
            ));

            await new MailingListConfirmationTokenCleanupCronJob().onTick();

            const left: MailingListSubscriptionConfirmationToken[] = await confirmationTokenRepository.findAll({
                where: { id: { oneOf: [expiredHere.id, expiredThere.id, live.id] } },
                acrossTenants: true
            });
            expect(left.map(t => t.id)).toEqual([live.id]);
        });
    });

    describe('unsubscribeFromList', () => {
        it('removes the mailing list from the subscriber', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('unsubscribe-list');
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'unsub@example.com',
                mailingLists: [list]
            });

            await service.unsubscribeFromList(list.id, subscriber.id);

            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists).toEqual([]);
        }));

        it('is idempotent when the subscriber is not subscribed to the list', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('unsubscribe-noop-list');
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'unsub-noop@example.com',
                mailingLists: []
            });

            await expect(service.unsubscribeFromList(list.id, subscriber.id)).resolves.toBeUndefined();

            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists).toEqual([]);
        }));
    });

    describe('queueEmailForList', () => {
        it('queues one email per subscriber of the list', async () => await inTenant(async () => {
            const list: MailingList = await createMailingList('queue-email-list');
            const subscriberA: MailingListSubscriber = await subscriberRepository.create({ email: 'queue-a@example.com', mailingLists: [list] });
            const subscriberB: MailingListSubscriber = await subscriberRepository.create({ email: 'queue-b@example.com', mailingLists: [list] });
            const unsubscribeLinks: string[] = [];

            await service.queueEmailForList(list.id, {
                subject: 'Newsletter',
                template: 'Hello {{name}}',
                compile: (template, data) => {
                    unsubscribeLinks.push(data.unsubscribeLink);
                    return `${template} - ${data.subscriber.email}`;
                }
            });

            const emails: Email[] = await emailRepository.findAll({ where: { subject: 'Newsletter' } });
            const recipients: string[] = emails.flatMap(e => e.recipients).sort();
            expect(recipients).toEqual([subscriberA.email, subscriberB.email].sort());
            // the links of each subscriber, naming the tenant, ready for the template
            const unsubscribeLinkOfA: string = await service.resolveUnsubscribeLink(list.id, subscriberA);
            expect(unsubscribeLinks).toContain(unsubscribeLinkOfA);
            // and the one a mailbox provider unsubscribes with, in the mail's headers
            expect(emails.find(e => e.recipients.includes(subscriberA.email))?.listUnsubscribeUrl).toBe(unsubscribeLinkOfA);
        }));
    });
});