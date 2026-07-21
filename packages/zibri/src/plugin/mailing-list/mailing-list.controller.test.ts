import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { h } from 'preact';

import { MailingListController } from './mailing-list.controller';
import { ZibriMailingListPlugin } from './mailing-list.plugin';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens';
import { MailingListBaseEmailTemplate } from './models/mailing-list-base-email-template.model';
import { MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model';
import { MailingListSubscribeConfirmationEmailTemplate } from './models/mailing-list-subscribe-confirmation-email-template.model';
import { MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken } from './models/mailing-list-subscription-confirmation-token.model';
import { MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model';
import { MailingList } from './models/mailing-list.model';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../../data-source/data-sources/postgres-typeorm-data-source.model';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { AppState } from '../../global/app-state.enum';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';

// eslint-disable-next-line unicorn/no-null
const baseEmailTemplate: MailingListBaseEmailTemplate = props => h('div', null, props.title);
const subscribeConfirmationEmailTemplate: MailingListSubscribeConfirmationEmailTemplate = props => h('a', { href: props.confirmEmailLink });
const preferencesPageTemplate: MailingListPreferencesPageTemplate = props => h('div', { id: 'preferences-page' }, props.subscriber.email);
const subscribeSuccessPageTemplate: MailingListSubscribeSuccessPageTemplate
    = props => h('div', { id: 'subscribe-success-page' }, props.subscriber.email);
const unsubscribeConfirmationPageTemplate: MailingListUnsubscribeConfirmationPageTemplate
    = props => h('div', { id: 'unsubscribe-confirmation-page' }, props.subscriber.email);

const dataSources: Newable<PostgresDataSource>[] = [
    createTestDataSource({
        entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken]
    })
];

describe('MailingListController', () => {
    describe('endpoints', () => {
        let server: StartedTestServer;
        let baseUrl: string;
        let mailingListRepository: Repository<MailingList>;
        let subscriberRepository: Repository<MailingListSubscriber>;
        let confirmationTokenRepository: Repository<MailingListSubscriptionConfirmationToken>;
        let mailingList: MailingList;

        beforeAll(async () => {
            server = await startTestServer({
                controllers: [MailingListController],
                plugins: [new ZibriMailingListPlugin()],
                dataSources,
                providers: [
                    ...defaultTestServerProviders,
                    defineProvider({ token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE, useValue: baseEmailTemplate }),
                    defineProvider({
                        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,
                        useValue: subscribeConfirmationEmailTemplate
                    }),
                    defineProvider({
                        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE,
                        useValue: preferencesPageTemplate
                    }),
                    defineProvider({
                        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE,
                        useValue: subscribeSuccessPageTemplate
                    }),
                    defineProvider({
                        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE,
                        useValue: unsubscribeConfirmationPageTemplate
                    })
                ]
            });
            baseUrl = await server.start();
            mailingListRepository = inject(repositoryTokenFor(MailingList));
            subscriberRepository = inject(repositoryTokenFor(MailingListSubscriber));
            confirmationTokenRepository = inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));

            mailingList = await mailingListRepository.create({ name: 'Newsletter', subscribers: [] });
        }, 15000);

        afterAll(async () => {
            await server?.shutdown();
        }, 15000);

        it('GET /:id/subscribe/:token confirms the subscription and renders the success page', async () => {
            const token: MailingListSubscriptionConfirmationToken = await confirmationTokenRepository.create({
                email: 'subscribe-me@example.com',
                value: 'subscribe-token',
                expirationDate: new Date(Date.now() + (Ms.SECOND * 60)),
                name: 'Subscriber',
                listId: mailingList.id
            });

            const res: Response = await fetch(`${baseUrl}/mailing-lists/${mailingList.id}/subscribe/${token.value}`);
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('subscribe-success-page');
            expect(html).toContain('subscribe-me@example.com');

            const subscriber: MailingListSubscriber = await subscriberRepository.findOne(
                { where: { email: 'subscribe-me@example.com' }, relations: ['mailingLists'] }
            );
            expect(subscriber.mailingLists.map(l => l.id)).toContain(mailingList.id);
        });

        it('GET /:id/unsubscribe removes the subscriber from the mailing list and renders the confirmation page', async () => {
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'unsubscribe-me@example.com',
                mailingLists: [mailingList]
            });

            const res: Response = await fetch(
                `${baseUrl}/mailing-lists/${mailingList.id}/unsubscribe?subscriberId=${subscriber.id}`
            );
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('unsubscribe-confirmation-page');

            const updated: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(updated.mailingLists.map(l => l.id)).not.toContain(mailingList.id);
        });

        it('GET /preferences renders the preferences page for the subscriber', async () => {
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'preferences@example.com',
                mailingLists: [mailingList]
            });

            const res: Response = await fetch(`${baseUrl}/mailing-lists/preferences?subscriberId=${subscriber.id}`);
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('preferences-page');
            expect(html).toContain('preferences@example.com');
        });

        it('PATCH /preferences updates the subscriber\'s mailing lists', async () => {
            const otherList: MailingList = await mailingListRepository.create({ name: 'Other list', subscribers: [] });
            const subscriber: MailingListSubscriber = await subscriberRepository.create({
                email: 'change-preferences@example.com',
                mailingLists: [mailingList]
            });

            const res: Response = await fetch(`${baseUrl}/mailing-lists/preferences?subscriberId=${subscriber.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mailingListIds: [otherList.id] })
            });
            expect(res.status).toBe(200);

            const updated: MailingListSubscriber = await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] });
            expect(updated.mailingLists.map(l => l.id)).toEqual([otherList.id]);
        });
    });

    describe('onAppInit', () => {
        // Each of these starts (and expects a rejection of) a fresh app, so the app state left behind by the
        // previous shutdown/rejection needs resetting first — mirrors what StartedTestServer.reInit() does internally.
        beforeEach(() => {
            GlobalRegistry['appData'].state = AppState.OFFLINE;
        });

        const templateProviders: DiProvider<unknown>[] = [
            defineProvider({ token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE, useValue: baseEmailTemplate }),
            defineProvider({
                token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,
                useValue: subscribeConfirmationEmailTemplate
            }),
            defineProvider({ token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE, useValue: preferencesPageTemplate }),
            defineProvider({
                token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE,
                useValue: subscribeSuccessPageTemplate
            }),
            defineProvider({
                token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE,
                useValue: unsubscribeConfirmationPageTemplate
            })
        ];

        it('rejects startup when the preferences page template is missing', async () => {
            await expect(startTestServer({
                controllers: [MailingListController],
                plugins: [new ZibriMailingListPlugin()],
                dataSources,
                providers: [
                    ...defaultTestServerProviders,
                    ...templateProviders.filter(p => p.token !== ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE)
                ]
            })).rejects.toThrow(/preferences_page_template/);
        }, 15000);

        it('rejects startup when the unsubscribe confirmation page template is missing', async () => {
            await expect(startTestServer({
                controllers: [MailingListController],
                plugins: [new ZibriMailingListPlugin()],
                dataSources,
                providers: [
                    ...defaultTestServerProviders,
                    ...templateProviders.filter(p => p.token !== ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE)
                ]
            })).rejects.toThrow(/unsubscribe_confirmation_page_template/);
        }, 15000);

        it('rejects startup when the subscribe success page template is missing', async () => {
            await expect(startTestServer({
                controllers: [MailingListController],
                plugins: [new ZibriMailingListPlugin()],
                dataSources,
                providers: [
                    ...defaultTestServerProviders,
                    ...templateProviders.filter(p => p.token !== ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE)
                ]
            })).rejects.toThrow(/subscribe_success_page_template/);
        }, 15000);
    });
});