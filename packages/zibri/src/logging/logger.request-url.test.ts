import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { LogLevel } from './log-level.enum';
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

@Controller('/failing')
class FailingController {
    @Get('/boom')
    boom(): string {
        throw new Error('a distinctive failure');
    }
}

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
        controllers: [AppMailingListController, LinkController, FailingController],
        plugins: [new ZibriMailingListPlugin()],
        // the client address case is about the option working: trusting a forwarded header from anyone
        // is not the default, and a server that left it unset would assert that the safe default is a bug
        security: { trustProxy: 1 },
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

describe('Logger — the request a line belongs to', () => {
    // 32 hex characters, since a traceparent that does not parse counts as none having arrived
    const callerTraceId: string = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const oneRequestTraceId: string = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

    // behind a load balancer, the socket address is the balancer's for every request
    it('records the client address a trusted proxy forwarded', async () => {
        await fetch(`${baseUrl}/failing/boom`, { headers: { 'x-forwarded-for': '203.0.113.7' } });

        expect((await persistedLogs()).some(l => l.context.request?.clientIp === '203.0.113.7')).toBe(true);
    });

    // an access line rather than a warning: a missing icon is routinely no concern, and the client
    // errors that are security events reach the audit trail instead
    it('records a client error as a line of the access log, with how long it took', async () => {
        expect((await fetch(`${baseUrl}/not-a-route`)).status).toBe(404);

        const lines: Log[] = (await persistedLogs()).filter(l => l.context.request?.url === '/not-a-route');
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every(l => l.level === LogLevel.INFO && l.context.request?.status === 404)).toBe(true);
        // known only once the response closed, which is why the access log is the line carrying it
        expect(lines.every(l => (l.context.request?.durationInMs ?? -1) >= 0)).toBe(true);
    });

    it('records the trace the caller sent', async () => {
        await fetch(`${baseUrl}/not-a-route`, { headers: { traceparent: `00-${callerTraceId}-0000000000000001-01` } });

        expect((await persistedLogs()).some(l => l.context.request?.traceId === callerTraceId)).toBe(true);
    });

    // a trace only an upstream service supplies is missing where a request arrived from outside
    it('gives a request that brought none a trace of its own', async () => {
        await fetch(`${baseUrl}/not-a-route?own-trace`);

        const ids: (string | undefined | null)[] = (await persistedLogs())
            .filter(l => l.context.request?.url === '/not-a-route' && l.context.request.traceId !== callerTraceId)
            .map(l => l.context.request?.traceId);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every(id => id != undefined && id !== '')).toBe(true);
    });

    // the error and the line saying the request happened are one story, joined without reading two clocks
    it('gives every line of one request the same trace', async () => {
        const res: Response = await fetch(`${baseUrl}/failing/boom`, { headers: { traceparent: `00-${oneRequestTraceId}-0000000000000001-01` } });
        expect(res.status).toBe(500);

        const lines: Log[] = (await persistedLogs()).filter(l => l.context.request?.traceId === oneRequestTraceId);
        expect(lines.some(l => l.level === LogLevel.ERROR)).toBe(true);
        expect(lines.some(l => l.context.request?.durationInMs != undefined)).toBe(true);
    });
});