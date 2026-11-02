import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

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
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { Email } from '../../email/models/email.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

// the links in the emails named /mailing-lists, wherever
// the application served the routes, and could not point at pages of a frontend

const TENANT: string = UUIDUtilities.generate();

const providers: DiProvider<unknown>[] = [
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
        useValue: compileTsxTemplate<MailingListPreferencesPageTemplate>('export const Page = () => <div></div>;')
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE,
        useValue: compileTsxTemplate<MailingListSubscribeSuccessPageTemplate>('export const Page = () => <div></div>;')
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE,
        useValue: compileTsxTemplate<MailingListUnsubscribeConfirmationPageTemplate>(
            'export const Page = ({ unsubscribed }) => <div>{unsubscribed ? "gone" : "confirm"}</div>;'
        )
    })
];

// one class for both applications: a data source class that one of them does not declare is refused
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken],
    repositories: defaultTestServerRepositories
});

// allowed to go unused, as the second application declares no controller
@Controller('/newsletter', { versions: 'all', allowOrphan: true })
class NewsletterController extends MailingListController {}

let server: StartedTestServer | undefined;
let baseUrl: string = '';

/**
 * Runs the given work in the tenant of this suite.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TENANT, fn);
}

/**
 * The mailing list service.
 * @returns The service.
 */
function service(): MailingListServiceInterface {
    return inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE);
}

/**
 * Creates a list with a subscriber on it.
 * @returns The list and the subscriber.
 */
async function createSubscribedList(): Promise<{ list: MailingList, subscriber: MailingListSubscriber }> {
    return await inTenant(async () => {
        const list: MailingList = await inject<Repository<MailingList>>(repositoryTokenFor(MailingList))
            .create({ name: `News ${UUIDUtilities.generate()}`, subscribers: [] });
        const subscriber: MailingListSubscriber = await inject<Repository<MailingListSubscriber>>(repositoryTokenFor(MailingListSubscriber))
            .create({ email: 'ada@example.com', mailingLists: [list] });
        return { list, subscriber };
    });
}

/**
 * Starts an application with the plugin and the given controllers.
 * @param controllers - The controllers it declares.
 * @param pagesUrl - Where the pages of the links are, if not at the controller.
 * @returns The url it answers at.
 */
async function startWith(controllers: Newable<unknown>[], pagesUrl?: string): Promise<string> {
    server = await startTestServer({
        controllers,
        plugins: [new ZibriMailingListPlugin()],
        dataSources: [dataSourceClass],
        providers: [...providers, defineProvider({ token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PAGES_URL, useValue: pagesUrl })]
    });
    return await server.start();
}

/**
 * The mail queued to a subscriber, read back from the queue.
 * @param recipient - The address it went to.
 * @returns The mail.
 */
async function findQueuedMail(recipient: string): Promise<Email | undefined> {
    const mails: Email[] = await inject<Repository<Email>>(repositoryTokenFor(Email)).findAll({ acrossTenants: true });
    return mails.find(m => m.recipients.includes(recipient));
}

describe('the links of a mailing list', () => {
    beforeAll(async () => {
        baseUrl = await startWith([NewsletterController]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('point at the path of the controller the application declares, and are answered there', async () => {
        const { list, subscriber } = await createSubscribedList();
        const link: URL = new URL(await inTenant(async () => await service().resolveUnsubscribeLink(list.id, subscriber)));

        expect(link.pathname).toBe(`/newsletter/${list.id}/unsubscribe`);
        const res: globalThis.Response = await fetch(`${baseUrl}${link.pathname}${link.search}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('confirm');
    });
});

describe('the links of a mailing list without a controller', () => {
    beforeAll(async () => {
        baseUrl = await startWith([]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('are refused, naming what is missing', async () => {
        const { list, subscriber } = await createSubscribedList();

        await expect(inTenant(async () => await service().resolveUnsubscribeLink(list.id, subscriber)))
            .rejects.toThrow(/found no controller extending[\S\s]*MailingListController/);
    });
});

describe('the links of a mailing list whose pages are on a frontend', () => {
    beforeAll(async () => {
        baseUrl = await startWith([NewsletterController], 'https://app.example.com/subscriptions/');
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('open the pages there, and unsubscribe in one click at the controller', async () => {
        const { list, subscriber } = await createSubscribedList();
        const email: string = `${UUIDUtilities.generate()}@example.com`;
        const own: MailingListSubscriber = await inTenant(async () => await inject<Repository<MailingListSubscriber>>(
            repositoryTokenFor(MailingListSubscriber)
        ).create({ email, mailingLists: [list] }));
        const pageLink: URL = new URL(await inTenant(async () => await service().resolveUnsubscribeLink(list.id, subscriber)));

        await inTenant(async () => await service().queueEmailForList(list.id, { subject: 'News', template: '', compile: () => '' }));

        expect(`${pageLink.origin}${pageLink.pathname}`).toBe(`https://app.example.com/subscriptions/${list.id}/unsubscribe`);
        const oneClick: URL = new URL((await findQueuedMail(email))?.listUnsubscribeUrl ?? '');
        expect(oneClick.pathname).toBe(`/newsletter/${list.id}/unsubscribe`);
        const res: globalThis.Response = await fetch(`${baseUrl}${oneClick.pathname}${oneClick.search}`, { method: 'POST' });
        expect(res.status).toBe(200);
        const left: MailingListSubscriber | undefined = await inTenant(async () => await inject<Repository<MailingListSubscriber>>(
            repositoryTokenFor(MailingListSubscriber)
        ).findOne({ where: { id: own.id }, required: false }));
        expect(left).toBeUndefined();
    });
});

describe('the links of a mailing list whose pages are on a frontend, without a controller', () => {
    beforeAll(async () => {
        baseUrl = await startWith([], 'https://app.example.com/newsletter');
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('open the pages there, and refuse the one-click link, which only a route of the application takes', async () => {
        const { list, subscriber } = await createSubscribedList();

        expect(await inTenant(async () => await service().resolveManagePreferencesLink(subscriber)))
            .toMatch(/^https:\/\/app\.example\.com\/newsletter\/preferences\?/);
        await expect(inTenant(async () => await service().resolveOneClickUnsubscribeLink(list.id, subscriber)))
            .rejects.toThrow(/found no controller extending[\S\s]*MailingListController/);
    });
});