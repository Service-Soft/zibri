import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { h } from 'preact';

import { MailingListServiceInterface, MailingListSubscriberCreateData } from './mailing-list-service.interface';
import { MailingListService } from './mailing-list.service';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { Email } from '../../../email/models/email.model';
import { ZibriMailingListPlugin } from '../mailing-list.plugin';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from '../mailing-list.tokens';
import { MailingListBaseEmailTemplate } from '../models/mailing-list-base-email-template.model';
import { MailingListSubscribeConfirmationEmailTemplate } from '../models/mailing-list-subscribe-confirmation-email-template.model';
import { MailingListSubscriber } from '../models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken } from '../models/mailing-list-subscription-confirmation-token.model';
import { MailingList } from '../models/mailing-list.model';

// eslint-disable-next-line unicorn/no-null
const baseEmailTemplate: MailingListBaseEmailTemplate = props => h('div', null, props.title);
const subscribeConfirmationEmailTemplate: MailingListSubscribeConfirmationEmailTemplate = props => h('a', { href: props.confirmEmailLink });

describe('MailingListService', () => {
    let server: StartedTestServer;
    let service: MailingListServiceInterface;
    let mailingListRepository: Repository<MailingList>;
    let subscriberRepository: Repository<MailingListSubscriber>;
    let confirmationTokenRepository: Repository<MailingListSubscriptionConfirmationToken>;
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
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    async function createMailingList(name: string): Promise<MailingList> {
        return mailingListRepository.create({ name, subscribers: [] });
    }

    describe('getSubscribeConfirmationLink / getUnsubscribeLink / getManagePreferencesLink', () => {
        it('builds the expected urls', () => {
            expect(service.getSubscribeConfirmationLink('list1', 'tok')).toBe('http://localhost:3000/mailing-lists/list1/subscribe/tok');
            expect(service.getUnsubscribeLink('list1', 'sub1')).toBe('http://localhost:3000/mailing-lists/list1/unsubscribe?subscriberId=sub1');
            expect(service.getManagePreferencesLink('sub1')).toBe('http://localhost:3000/mailing-lists/preferences?subscriberId=sub1');
        });
    });

    describe('requestSubscribeToList', () => {
        it('creates a confirmation token and queues a confirmation email for a brand new subscriber', async () => {
            const list: MailingList = await createMailingList('list-new-subscriber');
            const email: string = 'new-subscriber@example.com';

            await service.requestSubscribeToList(
                list.id,
                { email, name: 'New Subscriber' } as MailingListSubscriberCreateData,
                { subject: 'Please confirm' }
            );

            const tokens: MailingListSubscriptionConfirmationToken[] = await confirmationTokenRepository.findAll({ where: { email } });
            expect(tokens.length).toBe(1);
            expect(tokens[0].listId).toBe(list.id);

            const emails: Email[] = await emailRepository.findAll({ where: { recipients: { includes: [email] } } });
            expect(emails.length).toBe(1);
            expect(emails[0].subject).toBe('Please confirm');

            const subscribers: MailingListSubscriber[] = await subscriberRepository.findAll({ where: { email } });
            expect(subscribers.length).toBe(0);
        });

        it('directly attaches the mailing list when the subscriber already exists, without a new confirmation step', async () => {
            const listA: MailingList = await createMailingList('list-existing-a');
            const listB: MailingList = await createMailingList('list-existing-b');
            const email: string = 'existing-subscriber@example.com';

            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email, mailingLists: [listA] });

            await service.requestSubscribeToList(listB.id, { email } as MailingListSubscriberCreateData, { subject: 'irrelevant' });

            const updated: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(updated.mailingLists.map(l => l.id).sort()).toEqual([listA.id, listB.id].sort());

            const tokens: MailingListSubscriptionConfirmationToken[] = await confirmationTokenRepository.findAll({ where: { email } });
            expect(tokens.length).toBe(0);
        });
    });

    describe('confirmSubscribeToList', () => {
        async function createToken(listId: string, email: string): Promise<MailingListSubscriptionConfirmationToken> {
            return confirmationTokenRepository.create({
                email,
                value: `token-${email}-${listId}-${Date.now()}`,
                expirationDate: new Date(Date.now() + 60_000),
                listId,
                name: undefined
            });
        }

        it('creates a new subscriber when none exists yet', async () => {
            const list: MailingList = await createMailingList('confirm-new');
            const email: string = 'confirm-new@example.com';
            const token: MailingListSubscriptionConfirmationToken = await createToken(list.id, email);

            const subscriber: MailingListSubscriber = await service.confirmSubscribeToList(token.value);

            expect(subscriber.email).toBe(email);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists.map(l => l.id)).toEqual([list.id]);
        });

        it('attaches the list to an already existing subscriber', async () => {
            const listA: MailingList = await createMailingList('confirm-existing-a');
            const listB: MailingList = await createMailingList('confirm-existing-b');
            const email: string = 'confirm-existing@example.com';
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email, mailingLists: [listA] });
            const token: MailingListSubscriptionConfirmationToken = await createToken(listB.id, email);

            const result: MailingListSubscriber = await service.confirmSubscribeToList(token.value);

            expect(result.id).toBe(subscriber.id);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists.map(l => l.id).sort()).toEqual([listA.id, listB.id].sort());
        });

        it('is idempotent when the subscriber is already subscribed to the list', async () => {
            const list: MailingList = await createMailingList('confirm-idempotent');
            const email: string = 'confirm-idempotent@example.com';
            const subscriber: MailingListSubscriber = await subscriberRepository.create({ email, mailingLists: [list] });
            const token: MailingListSubscriptionConfirmationToken = await createToken(list.id, email);

            const result: MailingListSubscriber = await service.confirmSubscribeToList(token.value);

            expect(result.id).toBe(subscriber.id);
            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists.map(l => l.id)).toEqual([list.id]);
        });
    });

    describe('unsubscribeFromList', () => {
        it('removes the mailing list from the subscriber', async () => {
            const list: MailingList = await createMailingList('unsubscribe-list');
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'unsub@example.com',
                mailingLists: [list]
            });

            await service.unsubscribeFromList(list.id, subscriber.id);

            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists).toEqual([]);
        });

        it('is idempotent when the subscriber is not subscribed to the list', async () => {
            const list: MailingList = await createMailingList('unsubscribe-noop-list');
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'unsub-noop@example.com',
                mailingLists: []
            });

            await expect(service.unsubscribeFromList(list.id, subscriber.id)).resolves.toBeUndefined();

            const persisted: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(persisted.mailingLists).toEqual([]);
        });
    });

    describe('queueEmailForList', () => {
        it('queues one email per subscriber of the list', async () => {
            const list: MailingList = await createMailingList('queue-email-list');
            const subscriberA: MailingListSubscriber = await subscriberRepository.create({ email: 'queue-a@example.com', mailingLists: [list] });
            const subscriberB: MailingListSubscriber = await subscriberRepository.create({ email: 'queue-b@example.com', mailingLists: [list] });

            await service.queueEmailForList(list.id, {
                subject: 'Newsletter',
                template: 'Hello {{name}}',
                compile: (template, data) => `${template} - ${data.subscriber.email}`
            });

            const emails: Email[] = await emailRepository.findAll({ where: { subject: 'Newsletter' } });
            const recipients: string[] = emails.flatMap(e => e.recipients).sort();
            expect(recipients).toEqual([subscriberA.email, subscriberB.email].sort());
        });
    });
});