/* cspell:disable */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { MailingListController } from './mailing-list.controller.ts';
import { ZibriMailingListPlugin } from './mailing-list.plugin.ts';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens.ts';
import { MailingListBaseEmailTemplate } from './models/mailing-list-base-email-template.model.ts';
import { MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model.ts';
import { MailingListSubscribeConfirmationEmailTemplate } from './models/mailing-list-subscribe-confirmation-email-template.model.ts';
import { MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model.ts';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model.ts';
import { MailingListSubscriptionConfirmationToken } from './models/mailing-list-subscription-confirmation-token.model.ts';
import { MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model.ts';
import { MailingList } from './models/mailing-list.model.ts';
import { MailingListServiceInterface } from './services/mailing-list-service.interface.ts';
import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';

const ACME: string = UUIDUtilities.generate();
const GLOBEX: string = UUIDUtilities.generate();

let server: StartedTestServer | undefined;
let baseUrl: string = '';

/**
 * Runs the given work in a tenant.
 * @param tenantId - The tenant.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

/**
 * Creates a mailing list with one subscriber in a tenant.
 * @param tenantId - The tenant.
 * @param name - The name of the list.
 * @returns The subscriber.
 */
async function createSubscribedList(tenantId: string, name: string): Promise<MailingListSubscriber> {
    return await inTenant(tenantId, async () => {
        const list: MailingList = await inject<Repository<MailingList>>(repositoryTokenFor(MailingList)).create({ name, subscribers: [] });
        return await inject<Repository<MailingListSubscriber>>(repositoryTokenFor(MailingListSubscriber))
            .create({ email: `${name.toLowerCase()}@example.com`, mailingLists: [list] });
    });
}

describe('mailing lists across tenants', () => {
    beforeAll(async () => {
        server = await startTestServer({
            controllers: [MailingListController],
            plugins: [new ZibriMailingListPlugin()],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken]
                })
            ],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE,
                    useValue: compileTsxTemplate<MailingListBaseEmailTemplate>('export const Email = ({ title }) => <div>{title}</div>;')
                }),
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,
                    useValue: compileTsxTemplate<MailingListSubscribeConfirmationEmailTemplate>(
                        'export const Email = ({ confirmEmailLink }) => <a href={confirmEmailLink}></a>;'
                    )
                }),
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE,
                    useValue: compileTsxTemplate<MailingListPreferencesPageTemplate>(
                        'export const Page = ({ mailingLists }) => <div>{mailingLists.map(l => l.name).join(",")}</div>;'
                    )
                }),
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE,
                    useValue: compileTsxTemplate<MailingListSubscribeSuccessPageTemplate>('export const Page = () => <div></div>;')
                }),
                defineProvider({
                    token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE,
                    useValue: compileTsxTemplate<MailingListUnsubscribeConfirmationPageTemplate>('export const Page = () => <div></div>;')
                })
            ]
        });
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('opens the page a link in an email leads to in the tenant the link names, with that tenant\'s lists only', async () => {
        const ofAcme: MailingListSubscriber = await createSubscribedList(ACME, 'Acme-News');
        await createSubscribedList(GLOBEX, 'Globex-News');
        const service: MailingListServiceInterface = inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE);

        const link: URL = new URL(await inTenant(ACME, async () => await service.resolveManagePreferencesLink(ofAcme)));
        // the application's baseUrl is not where the test reaches it, the path and query are the link's
        const res: Response = await fetch(`${baseUrl}${link.pathname}${link.search}`);

        expect(res.status).toBe(200);
        const html: string = await res.text();
        expect(html).toContain('Acme-News');
        expect(html).not.toContain('Globex-News');
        // the same link naming another tenant reaches no row of it, and answers like any link that
        // names no subscriber
        link.searchParams.set('x-tenant-id', GLOBEX);
        expect((await fetch(`${baseUrl}${link.pathname}${link.search}`)).status).toBe(401);
    });
});