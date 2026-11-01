import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Log } from './log.model';
import { LoggerInterface } from './logger.interface';
import { compileTsxTemplate } from '../__testing__/compile-tsx-template.function';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { MailingListController } from '../plugin/mailing-list/mailing-list.controller';
import { ZibriMailingListPlugin } from '../plugin/mailing-list/mailing-list.plugin';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from '../plugin/mailing-list/mailing-list.tokens';
import { MailingListBaseEmailTemplate } from '../plugin/mailing-list/models/mailing-list-base-email-template.model';
import { MailingListPreferencesPageTemplate } from '../plugin/mailing-list/models/mailing-list-preferences-page-template.model';
import { MailingListSubscribeConfirmationEmailTemplate } from '../plugin/mailing-list/models/mailing-list-subscribe-confirmation-email-template.model';
import { MailingListSubscribeSuccessPageTemplate } from '../plugin/mailing-list/models/mailing-list-subscribe-success-page-template.model';
import { MailingListSubscriber } from '../plugin/mailing-list/models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken } from '../plugin/mailing-list/models/mailing-list-subscription-confirmation-token.model';
import { MailingListUnsubscribeConfirmationPageTemplate } from '../plugin/mailing-list/models/mailing-list-unsubscribe-confirmation-page-template.model';
import { MailingList } from '../plugin/mailing-list/models/mailing-list.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const SECRET: string = 'permanent-subscriber-secret';
const TOKEN: string = 'one-time-link-token';

@Controller('/links')
class LinkController {
    @Get('/open')
    open(
        @Param.query('token', { type: 'string' })
        token: string
    ): string {
        // a line written while the request is handled, which carries the request it was written in
        inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).info('opening a link');
        return token.length.toString();
    }
}

@Controller('/mailing-lists', { versions: 'all' })
class AppMailingListController extends MailingListController {}

let server: StartedTestServer | undefined;
let baseUrl: string = '';
let logRepository: Repository<Log>;

/**
 * Every row the logger wrote, in whatever tenant, once its queue has drained.
 * @returns The rows.
 */
async function persistedLogs(): Promise<Log[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return await logRepository.findAll({ acrossTenants: true });
}

/**
 * Whether a row carries the given text anywhere: in its message or in any part of its context.
 * @param log - The row.
 * @param text - The text.
 * @returns True when the text is in the row.
 */
function carries(log: Log, text: string): boolean {
    return log.message.includes(text) || JsonUtilities.stringify(log.context).includes(text);
}

beforeAll(async () => {
    server = await startTestServer({
        controllers: [AppMailingListController, LinkController],
        plugins: [new ZibriMailingListPlugin()],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken],
                repositories: defaultTestServerRepositories
            })
        ],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_LOG, useValue: true }),
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
                useValue: compileTsxTemplate<MailingListUnsubscribeConfirmationPageTemplate>('export const Page = () => <div></div>;')
            })
        ]
    });
    baseUrl = await server.start();
    logRepository = inject(repositoryTokenFor(Log));
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('Logger — the url of a request', () => {
    it('records the path of a refused mailing-list link, never the secret the link carried', async () => {
        // the tenant the link names, as a link in a mail does
        const query: string = `x-tenant-id=${UUIDUtilities.generate()}&subscriberId=${UUIDUtilities.generate()}&secret=${SECRET}`;
        const res: Response = await fetch(`${baseUrl}/mailing-lists/preferences?${query}`);
        expect(res.status).toBe(401);

        const logs: Log[] = await persistedLogs();

        // the request was recorded at all, so the assertion below is not satisfied by an empty table
        expect(logs.some(log => log.context.request?.url === '/mailing-lists/preferences')).toBe(true);
        expect(logs.filter(log => carries(log, SECRET))).toEqual([]);
    });

    it('records the path on every line a request wrote, and the line of the access log, without the query string', async () => {
        const res: Response = await fetch(`${baseUrl}/links/open?token=${TOKEN}`);
        expect(res.status).toBe(200);

        const logs: Log[] = await persistedLogs();
        const ofRequest: Log[] = logs.filter(log => log.context.request?.url === '/links/open');

        // the line the handler wrote, and the one the access log wrote once the response had closed
        expect(ofRequest.length).toBeGreaterThanOrEqual(2);
        expect(ofRequest.some(log => log.message === 'GET /links/open 200')).toBe(true);
        expect(logs.filter(log => carries(log, TOKEN))).toEqual([]);
    });
});