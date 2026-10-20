import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MailingListController } from './mailing-list.controller.ts';
import { ZibriMailingListPlugin } from './mailing-list.plugin.ts';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens.ts';
import { MailingListBaseEmailTemplate } from './models/mailing-list-base-email-template.model.ts';
import { MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model.ts';
import { MailingListSubscribeConfirmationEmailTemplate } from './models/mailing-list-subscribe-confirmation-email-template.model.ts';
import { MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model.ts';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model.ts';
import { MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from './models/mailing-list-subscription-confirmation-token.model.ts';
import { MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model.ts';
import { MailingList } from './models/mailing-list.model.ts';
import { MailingListServiceInterface } from './services/mailing-list-service.interface.ts';
import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model.ts';
import { AppState } from '../../global/app-state.enum.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';

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
        'export const Page = ({ subscriber }) => <div id="preferences-page">{subscriber.email} on {subscriber.mailingLists.map(l => l.name).join(",")}</div>;'
    );
const subscribeSuccessPageTemplate: MailingListSubscribeSuccessPageTemplate
    = compileTsxTemplate<MailingListSubscribeSuccessPageTemplate>(
        'export const Page = ({ subscriber }) => <div id="subscribe-success-page">{subscriber.email}</div>;'
    );
const unsubscribeConfirmationPageTemplate: MailingListUnsubscribeConfirmationPageTemplate
    = compileTsxTemplate<MailingListUnsubscribeConfirmationPageTemplate>(
        'export const Page = ({ subscriber, unsubscribed, unsubscribeUrl }) => unsubscribed ? <div id="unsubscribed">{subscriber.email}</div> : <form id="unsubscribe-form" method="post" action={unsubscribeUrl}></form>;'
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
        let confirmationTokenRepository: Repository<
            MailingListSubscriptionConfirmationToken,
            MailingListSubscriptionConfirmationTokenCreateData
        >;
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
        }, 30000);

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
            // the token as the link carries it: the row holds it hashed
            const token: string = 'subscribe-token';
            await inTenant(async () => await confirmationTokenRepository.create({
                email: 'subscribe-me@example.com',
                value: token,
                expirationDate: new Date(Date.now() + (Ms.SECOND * 60)),
                name: 'Subscriber',
                listId: mailingList.id,
                spent: false
            }));

            const res: Response = await fetch(
                await linkOf(async () => await mailingListService().resolveSubscribeConfirmationLink(mailingList.id, token))
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

        it('GET /:id/subscribe/:token refuses a token for another list than the one it names, and subscribes to neither', async () => {
            const otherList: MailingList = await inTenant(async () => await mailingListRepository.create({ name: 'Other news', subscribers: [] }));
            const token: string = 'other-list-token';
            await inTenant(async () => await confirmationTokenRepository.create({
                email: 'other-list@example.com',
                value: token,
                expirationDate: new Date(Date.now() + (Ms.SECOND * 60)),
                listId: mailingList.id,
                spent: false
            }));

            const res: Response = await fetch(
                await linkOf(async () => await mailingListService().resolveSubscribeConfirmationLink(otherList.id, token))
            );

            expect(res.status).toBe(401);
            expect(await inTenant(async () => await subscriberRepository.findAll({ where: { email: 'other-list@example.com' } }))).toEqual([]);
        });

        it('GET /:id/unsubscribe renders the page with its button and leaves the subscriber on the mailing list', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'unsubscribe-me@example.com',
                mailingLists: [mailingList]
            }));
            const link: string = await linkOf(async () => await mailingListService().resolveUnsubscribeLink(mailingList.id, subscriber));

            // what a mail scanner or a link preview does with the link
            const res: Response = await fetch(link);
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('unsubscribe-form');
            expect(html).not.toContain('id="unsubscribed"');

            const updated: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] })
            );
            expect(updated.mailingLists.map(l => l.id)).toContain(mailingList.id);
        });

        it('POST /:id/unsubscribe, as the button sends it, removes the subscriber from the mailing list and says so', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'unsubscribe-button@example.com',
                mailingLists: [mailingList]
            }));

            const res: Response = await fetch(
                await linkOf(async () => await mailingListService().resolveUnsubscribeLink(mailingList.id, subscriber)),
                { method: 'POST' }
            );
            expect(res.status).toBe(200);
            expect(await res.text()).toContain('id="unsubscribed"');

            const updated: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] })
            );
            expect(updated.mailingLists.map(l => l.id)).not.toContain(mailingList.id);
        });

        it('POST /:id/unsubscribe answers the one-click unsubscribe a mailbox provider sends (RFC 8058)', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'unsubscribe-one-click@example.com',
                mailingLists: [mailingList]
            }));

            const res: Response = await fetch(
                await linkOf(async () => await mailingListService().resolveUnsubscribeLink(mailingList.id, subscriber)),
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: 'List-Unsubscribe=One-Click'
                }
            );
            expect(res.status).toBe(200);

            const updated: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] })
            );
            expect(updated.mailingLists.map(l => l.id)).not.toContain(mailingList.id);
        });

        it('refuses every link of a subscriber that carries their id without their secret', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'guessed@example.com',
                mailingLists: [mailingList]
            }));
            const unsubscribe: URL = new URL(await linkOf(async () => await mailingListService().resolveUnsubscribeLink(mailingList.id, subscriber)));
            const preferences: URL = new URL(await linkOf(async () => await mailingListService().resolveManagePreferencesLink(subscriber)));
            unsubscribe.searchParams.set('secret', 'not-the-secret');
            preferences.searchParams.set('secret', 'not-the-secret');

            expect((await fetch(unsubscribe)).status).toBe(401);
            expect((await fetch(unsubscribe, { method: 'POST' })).status).toBe(401);
            expect((await fetch(preferences)).status).toBe(401);
            expect((await fetch(preferences, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ mailingListIds: [] })
            })).status).toBe(401);
            // the id alone, as every link carried it before
            preferences.searchParams.delete('secret');
            expect((await fetch(preferences)).status).toBe(400);

            const updated: MailingListSubscriber = await inTenant(
                async () => await subscriberRepository.findById(subscriber.id, { relations: ['mailingLists'] })
            );
            expect(updated.mailingLists.map(l => l.id)).toEqual([mailingList.id]);
        });

        it('GET /preferences renders the preferences page for the subscriber, with the lists they are on', async () => {
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'preferences@example.com',
                mailingLists: [mailingList]
            }));
            const link: URL = new URL(await linkOf(async () => await mailingListService().resolveManagePreferencesLink(subscriber)));

            const res: Response = await fetch(link);
            expect(res.status).toBe(200);
            const html: string = await res.text();
            expect(html).toContain('preferences-page');
            expect(html).toContain(`preferences@example.com on ${mailingList.name}`);
            // without the tenant, the subscriber is no row any route reaches
            link.searchParams.delete('x-tenant-id');
            expect((await fetch(link)).status).toBe(400);
        });

        it('PATCH /preferences updates the subscriber\'s mailing lists', async () => {
            const otherList: MailingList = await inTenant(async () => await mailingListRepository.create({ name: 'Other list', subscribers: [] }));
            const subscriber: MailingListSubscriber = await inTenant(async () => await subscriberRepository.create({
                email: 'change-preferences@example.com',
                mailingLists: [mailingList]
            }));

            const res: Response = await fetch(await linkOf(async () => await mailingListService().resolveManagePreferencesLink(subscriber)), {
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
        }, 30000);

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
        }, 30000);

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
        }, 30000);
    });
});