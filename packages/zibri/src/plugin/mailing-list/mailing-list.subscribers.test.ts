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
import { defineProvider } from '../../di/models/di-provider.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

const TENANT: string = UUIDUtilities.generate();

@Controller('/mailing-lists', { versions: 'all' })
class AppMailingListController extends MailingListController {}

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
 * The repository of the subscribers.
 * @returns The repository.
 */
function subscribers(): Repository<MailingListSubscriber> {
    return inject(repositoryTokenFor(MailingListSubscriber));
}

/**
 * Creates mailing lists of the given names, each made unique, as a list's name is in its tenant.
 * @param names - The names.
 * @returns The lists.
 */
async function createLists(...names: string[]): Promise<MailingList[]> {
    const repository: Repository<MailingList> = inject(repositoryTokenFor(MailingList));
    return await inTenant(async () => await Promise.all(
        names.map(async name => await repository.create({ name: `${name} ${UUIDUtilities.generate()}`, subscribers: [] }))
    ));
}

/**
 * Creates a subscriber on the given lists.
 * @param email - Their address.
 * @param lists - The lists they are on.
 * @returns The subscriber.
 */
async function createSubscriber(email: string, lists: MailingList[]): Promise<MailingListSubscriber> {
    return await inTenant(async () => await subscribers().create({ email, mailingLists: lists }));
}

/**
 * Reads a subscriber back, with their lists.
 * @param id - The id of the subscriber.
 * @returns The subscriber, or undefined when the row is gone.
 */
async function findSubscriber(id: string): Promise<MailingListSubscriber | undefined> {
    return await inTenant(async () => await subscribers().findOne({ where: { id }, relations: ['mailingLists'], required: false }));
}

/**
 * Turns a link the service resolved into one the test server answers: the application's baseUrl is
 * not where the test reaches it, the path and query are the link's.
 * @param link - The link.
 * @returns The url to call.
 */
function onServer(link: string): string {
    const url: URL = new URL(link);
    return `${baseUrl}${url.pathname}${url.search}`;
}

/**
 * A subscriber is kept only while they are on a list: an address on none was kept for good, whichever
 * way it left its last list (08 §X27).
 */
describe('a mailing list subscriber on no list', () => {
    beforeAll(async () => {
        server = await startTestServer({
            controllers: [AppMailingListController],
            plugins: [new ZibriMailingListPlugin()],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken],
                    repositories: defaultTestServerRepositories
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
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('is deleted when they unsubscribe from their last list', async () => {
        const [news] = await createLists('News');
        const ada: MailingListSubscriber = await createSubscriber('ada@example.com', news == undefined ? [] : [news]);

        await inTenant(async () => await service().unsubscribeFromList(news?.id ?? '', ada.id));

        expect(await findSubscriber(ada.id)).toBeUndefined();
    });

    it('is kept while they are on another list', async () => {
        const [news, releases] = await createLists('News', 'Releases');
        const ada: MailingListSubscriber = await createSubscriber('ada@example.com', [news, releases].filter(l => l != undefined));

        await inTenant(async () => await service().unsubscribeFromList(news?.id ?? '', ada.id));

        expect((await findSubscriber(ada.id))?.mailingLists.map(l => l.id)).toEqual([releases?.id]);
    });

    it('is deleted by the one-click unsubscribe of their last list, which still answers with its page', async () => {
        const [news] = await createLists('News');
        const ada: MailingListSubscriber = await createSubscriber('ada@example.com', news == undefined ? [] : [news]);
        const link: string = await inTenant(async () => await service().resolveUnsubscribeLink(news?.id ?? '', ada));

        const res: globalThis.Response = await fetch(onServer(link), { method: 'POST' });

        expect(res.status).toBe(200);
        expect(await res.text()).toContain('gone');
        expect(await findSubscriber(ada.id)).toBeUndefined();
    });

    it('is deleted when they choose no list on the preferences page', async () => {
        const [news] = await createLists('News');
        const ada: MailingListSubscriber = await createSubscriber('ada@example.com', news == undefined ? [] : [news]);
        const link: string = await inTenant(async () => await service().resolveManagePreferencesLink(ada));

        const res: globalThis.Response = await fetch(onServer(link), {
            method: 'PATCH',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ mailingListIds: [] })
        });

        expect(res.status).toBe(204);
        expect(await findSubscriber(ada.id)).toBeUndefined();
    });

    it('is deleted with the list that was their last, and kept when they are on another', async () => {
        const [news, releases] = await createLists('News', 'Releases');
        const ada: MailingListSubscriber = await createSubscriber('ada@example.com', news == undefined ? [] : [news]);
        const grace: MailingListSubscriber = await createSubscriber('grace@example.com', [news, releases].filter(l => l != undefined));

        await inTenant(async () => await service().deleteList(news?.id ?? ''));

        expect(await findSubscriber(ada.id)).toBeUndefined();
        expect((await findSubscriber(grace.id))?.mailingLists.map(l => l.id)).toEqual([releases?.id]);
        const remaining: MailingList[] = await inTenant(async () => await inject<Repository<MailingList>>(repositoryTokenFor(MailingList))
            .findAll({ where: { id: news?.id ?? '' } }));
        expect(remaining).toEqual([]);
    });
});