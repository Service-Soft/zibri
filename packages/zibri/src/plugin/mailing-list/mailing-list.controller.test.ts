import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

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
import { MailingListServiceInterface } from './services/mailing-list-service.interface';
import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { AppState } from '../../global/app-state.enum';
import { GlobalRegistry } from '../../global/global-registry';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

const baseEmailTemplate: MailingListBaseEmailTemplate = compileTsxTemplate<MailingListBaseEmailTemplate>(
    'export const Email = ({ title }) => <div>{title}</div>;'
);
const subscribeConfirmationEmailTemplate: MailingListSubscribeConfirmationEmailTemplate
    = compileTsxTemplate<MailingListSubscribeConfirmationEmailTemplate>(
        'export const Email = ({ confirmEmailLink }) => <a href={confirmEmailLink}></a>;'
    );
// Page templates are compiled by zibri-tsx in a real app; the tests compile inline source the same
// way, so the controller renders exactly the compiled-component shape it will see in production.
const preferencesPageTemplate: MailingListPreferencesPageTemplate
    = compileTsxTemplate<MailingListPreferencesPageTemplate>(
        'export const Page = ({ subscriber }) => <div id="preferences-page">{subscriber.email}</div>;'
    );
const subscribeSuccessPageTemplate: MailingListSubscribeSuccessPageTemplate
    = compileTsxTemplate<MailingListSubscribeSuccessPageTemplate>(
        'export const Page = ({ subscriber }) => <div id="subscribe-success-page">{subscriber.email}</div>;'
    );
const unsubscribeConfirmationPageTemplate: MailingListUnsubscribeConfirmationPageTemplate
    = compileTsxTemplate<MailingListUnsubscribeConfirmationPageTemplate>(
        'export const Page = ({ subscriber }) => <div id="unsubscribe-confirmation-page">{subscriber.email}</div>;'
    );

const dataSources: Newable<PostgresDataSource>[] = [
    createTestDataSource({
        entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken]
    })
];

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
 * The mailing list service of the running application, which the links of the emails come from.
 * @returns The service.
 */
function mailingListService(): MailingListServiceInterface {
    return inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE);
}

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

            mailingList = await inTenant(async () => await mailingListRepository.create({ name: 'Newsletter', subscribers: [] }));
        }, 15000);

        afterAll(async () => {
            await server?.shutdown();
        }, 15000);

        /**
         * Resolves a link the emails carry, aimed at the running test server.
         * @param resolve - Resolves the link, in the tenant of the tests.
         * @returns The link: the application's baseUrl is not where the test reaches it, the path and
         * query are the link's.
         */
        async function linkOf(resolve: () => Promise<string>): Promise<string> {
            const link: URL = new URL(await inTenant(resolve));
            return `${baseUrl}${link.pathname}${link.search}`;
        }

        // each follows the link the emails carry, which names the tenant: following one sends no header
        it('GET /:id/subscribe/:token confirms the subscription and renders the success page', async () => {
            const token: MailingListSubscriptionConfirmationToken = await inTenant(async () => await confirmationTokenRepository.create({
                email: 'subscribe-me@example.com',
                value: 'subscribe-token',
                expirationDate: new Date(Date.now() + (Ms.SECOND * 60)),
                name: 'Subscriber',
                listId: mailingList.id
            }));

            const res: Response = await fetch(
                await linkOf(async () => await mailingListService().resolveSubscribeConfirmationLink(mailingList.id, token.value))
            );
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('subscribe-success-page');
            expect(html).toContain('subscribe-me@example.com');

            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.findOne(
                { where: { email: 'subscribe-me@example.com' }, relations: ['mailingLists'] }
            ));
            expect(subscriber.mailingLists.map(l => l.id)).toContain(mailingList.id);
        });

        it('GET /:id/unsubscribe removes the subscriber from the mailing list and renders the confirmation page', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'unsubscribe-me@example.com',
                mailingLists: [mailingList]
            }));

            const res: Response = await fetch(
                await linkOf(async () => await mailingListService().resolveUnsubscribeLink(mailingList.id, subscriber.id))
            );
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('unsubscribe-confirmation-page');

            const updated: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] })
            );
            expect(updated.mailingLists.map(l => l.id)).not.toContain(mailingList.id);
        });

        it('GET /preferences renders the preferences page for the subscriber', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'preferences@example.com',
                mailingLists: [mailingList]
            }));

            const res: Response = await fetch(await linkOf(async () => await mailingListService().resolveManagePreferencesLink(subscriber.id)));
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('preferences-page');
            expect(html).toContain('preferences@example.com');
            // without the tenant, the subscriber is no row any route reaches
            expect((await fetch(`${baseUrl}/mailing-lists/preferences?subscriberId=${subscriber.id}`)).status).toBe(400);
        });

        it('PATCH /preferences updates the subscriber\'s mailing lists', async () => {
            const otherList: MailingList = await inTenant(async () => await mailingListRepository.create({ name: 'Other list', subscribers: [] }));
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'change-preferences@example.com',
                mailingLists: [mailingList]
            }));

            const res: Response = await fetch(await linkOf(async () => await mailingListService().resolveManagePreferencesLink(subscriber.id)), {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ mailingListIds: [otherList.id] })
            });
            // the handler declares @Response.empty() and returns void, and a handler with nothing to
            // send answers 204 rather than a 200 with an empty body (router.ts). The assertion below
            // is what says the change landed, which is all this endpoint was ever going to report.
            expect(res.status).toBe(204);

            const updated: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] })
            );
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