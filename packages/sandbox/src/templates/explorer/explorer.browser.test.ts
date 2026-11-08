import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page, Request, Response as PlaywrightResponse } from 'playwright';
import { $ts, AsyncApiDefinition, AsyncApiService, Auth, Controller, defineProvider, Get, inject, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor, UUIDUtilities, Version, ZibriApplication, ZIBRI_DI_TOKENS } from 'zibri';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { version } from '../../../package.json';
import { testApplicationOptions } from '../../__testing__/test-application-options';
import { Permissions, User } from '../../models';
import { UserRepository } from '../../repositories';

const TIMEOUT: number = 30000;

const PROJECT_ROOT: string = path.join(__dirname, '..', '..', '..');

/**
 * Builds the stylesheet the way the build does, with Tailwind through postcss.
 *
 * In a process of its own, because Tailwind and what it loads ship as es modules, which jest cannot require.
 * @returns The stylesheet the pages are served with.
 */
function buildStylesheet(): string {
    const script: string = [
        'import { readFileSync } from \'node:fs\';',
        'import postcss from \'postcss\';',
        'import tailwind from \'@tailwindcss/postcss\';',
        'const from = process.argv[1];',
        'const result = await postcss([tailwind()]).process(readFileSync(from, \'utf8\'), { from });',
        'process.stdout.write(result.css);'
    ].join('\n');
    return execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', script, path.join(PROJECT_ROOT, 'assets', 'public', 'style.css')],
        { cwd: PROJECT_ROOT, encoding: 'utf8' }
    );
}

/**
 * What a login with a password answers with, as far as a test reads it.
 */
type LoginAnswer = {
    accessToken: { value: string }
};

// the ids the explorer gives an operation: its tag, its method and its path
const HEALTH_LIVE: string = 'HealthController-get--health-live';
const TEMPLATE_LOG: string = 'TemplateController-get--templates-log';
const LOGIN: string = 'AppAuthController-post--auth-login';
const LOGINS: string = 'AppAuthController-get--auth-logins';
// `@Post()` is at `/files/`
const FILE_UPLOAD: string = 'FileController-post--files-';
// `@Get()` is at `/explorer-permissions/`
const PERMISSION_READ: string = 'ExplorerPermissionController-get--explorer-permissions-';
// the ids the explorer gives an event: its tag and its operation
const CHAT_MESSAGE: string = 'asyncapi-TestWebsocketController-TestWebsocketController_receiveChatMessage';

// no route of this application requires a permission, so the explorer is shown one that does. Orphan
// allowed, since the suite below starts a server without it
@Controller('/explorer-permissions', { versions: 'all', allowOrphan: true })
class ExplorerPermissionController {
    @Auth.hasPermission(Permissions.AUTH_ASSIGN_ROLE_WITH_ANY_PERMISSION)
    @Get()
    read(): { ok: boolean } {
        return { ok: true };
    }
}

describe('the OpenAPI explorer, in a browser', () => {
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let appUrl: string;
    let browser: PageBrowser;
    let page: Page;
    // the assets folder holds the source of the stylesheet, which the build runs through Tailwind. Built
    // here the same way, so the page is laid out as it is in the application
    let stylesheet: string;

    beforeAll(async () => {
        stylesheet = buildStylesheet();
        server = await startTestServer({
            application: { ...testApplicationOptions, controllers: [...testApplicationOptions.controllers, ExplorerPermissionController] }
        });
        appUrl = await server.start();
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl } });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    async function open(path: string = '/explorer'): Promise<void> {
        page = await browser.open(`${baseUrl}${path}`, async opened => {
            await opened.route('**/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        // below the timeout of a test, so a missing element is named rather than the test timing out
        page.setDefaultTimeout(5000);
    }

    async function expand(operation: string): Promise<void> {
        await page.locator(`#${operation} > summary`).click();
    }

    async function execute(operation: string): Promise<string> {
        // the result of a request sent before is cleared, so the status read is the one of this request
        await page.locator(`#${operation}-clear`).click();
        await page.locator(`#${operation}-result`).waitFor({ state: 'detached' });
        await page.locator(`#${operation}-execute`).click();
        await page.locator(`#${operation}-result-status`).waitFor({ state: 'visible' });
        return await page.locator(`#${operation}-result-status`).textContent() ?? '';
    }

    async function createUser(): Promise<{ email: string, password: string }> {
        const email: string = `explorer-${UUIDUtilities.generate()}@example.com`;
        const password: string = 'a password long enough';
        const user: User = await inject(UserRepository).create({ name: 'Ada', email, roles: [] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password, userId: user.id });
        return { email, password };
    }

    it('shows the document of the latest version, its operations grouped by controller', async () => {
        await open();

        expect(await page.title()).toBe('Explorer | Zibri Api');
        expect(await page.locator('#explorer-title').textContent()).toBe(`Zibri Api ${version}`);
        expect(await page.locator('#explorer-version').inputValue()).toBe(`/explorer/${version}`);
        expect(await page.locator('#tag-HealthController').count()).toBe(1);
        expect(await page.locator(`#${HEALTH_LIVE}-path`).textContent()).toBe('/health/live');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('starts each document with a bar naming its server and what the server is', async () => {
        await open();

        // the one server leaves nothing to choose
        expect(await page.locator('#explorer-server').count()).toBe(0);
        expect(await page.locator('#explorer-server-url').textContent()).toBe('/');
        expect(await page.locator('#explorer-server-description-0').textContent()).toContain('This application.');
        expect(await page.locator('#explorer-server-description-0').isVisible()).toBe(true);

        await page.locator('#button-asyncapi').click();
        expect(await page.locator('#asyncapi-server-application-url').textContent()).toMatch(/^wss?:\/\/.+\/socket\.io$/);
        expect(await page.locator('#asyncapi-server-application').textContent()).toContain('A socket.io server.');
    }, TIMEOUT);

    it('links each document on its own tab, with the version of its specification', async () => {
        await open();

        expect(await page.locator('#explorer-document').getAttribute('href')).toBe(`/explorer/spec/${version}`);
        expect(await page.locator('#explorer-document-version').textContent()).toBe('OpenAPI 3.1.0');
        expect(await page.locator('#explorer-asyncapi-document').isVisible()).toBe(false);

        await page.locator('#button-asyncapi').click();
        expect(await page.locator('#explorer-asyncapi-document').getAttribute('href')).toBe(`/explorer/asyncapi/${version}`);
        expect(await page.locator('#explorer-asyncapi-document-version').textContent()).toBe('AsyncAPI 3.0.0');
        expect(await page.locator('#explorer-document').isVisible()).toBe(false);
        // the explorer sends no event, so authorize is the one of the OpenAPI document
        expect(await page.locator('#explorer-authorize').isVisible()).toBe(false);
    }, TIMEOUT);

    it('shows the OpenAPI document first, and the AsyncAPI document in the other tab', async () => {
        await open();

        expect(await page.locator('#openapi').isVisible()).toBe(true);
        expect(await page.locator('#asyncapi').isVisible()).toBe(false);

        await page.locator('#button-asyncapi').click();

        expect(await page.locator('#openapi').isVisible()).toBe(false);
        expect(await page.locator('#asyncapi').isVisible()).toBe(true);
        await page.locator(`#${CHAT_MESSAGE} > summary`).click();
        expect(await page.locator(`#${CHAT_MESSAGE}-address`).textContent()).toBe('chat message');
        expect(JSON.parse(await page.locator(`#${CHAT_MESSAGE}-message-0-example`).textContent() ?? '')).toMatchObject({ body: { message: 'string' } });
        expect(await page.locator(`#${CHAT_MESSAGE}-reply-0`).count()).toBe(1);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('names the tabs by the tab bar they are in, for assistive technology', async () => {
        await open();

        expect(await page.locator('#button-openapi').getAttribute('aria-selected')).toBe('true');
        expect(await page.locator('#button-asyncapi').getAttribute('aria-selected')).toBe('false');
        expect(await page.locator('#asyncapi').getAttribute('role')).toBe('tabpanel');
    }, TIMEOUT);

    it('marks an operation that requires a login with a lock, which opens the authorize dialog and closes once a token is entered', async () => {
        await open();

        expect(await page.locator(`#${LOGINS}-lock`).getAttribute('title')).toBe('Requires a login with jwt');
        expect(await page.locator(`#${HEALTH_LIVE}-lock`).count()).toBe(0);
        expect(await page.locator(`#${LOGINS}-lock-open`).isVisible()).toBe(true);
        expect(await page.locator(`#${LOGINS}-lock-closed`).isVisible()).toBe(false);

        await page.locator(`#${LOGINS}-lock`).click();
        expect(await page.locator('#explorer-authorize-dialog').isVisible()).toBe(true);
        // the lock sits in the summary, and opening the dialog leaves the operation as it was
        expect(await page.locator(`#${LOGINS}`).getAttribute('open')).toBeNull();

        await page.locator('#explorer-authorize-jwt').fill('a token');
        await page.locator('#explorer-authorize-save').click();
        expect(await page.locator(`#${LOGINS}-lock-closed`).isVisible()).toBe(true);
        expect(await page.locator(`#${LOGINS}-lock-open`).isVisible()).toBe(false);

        await page.locator('#explorer-authorize').click();
        await page.locator('#explorer-authorize-clear').click();
        expect(await page.locator(`#${LOGINS}-lock-open`).isVisible()).toBe(true);
    }, TIMEOUT);

    it('names the permission an operation requires', async () => {
        await open();

        expect(await page.locator(`#${PERMISSION_READ}-permissions`).textContent()).toBe(Permissions.AUTH_ASSIGN_ROLE_WITH_ANY_PERMISSION);
        expect(await page.locator(`#${HEALTH_LIVE}-permissions`).textContent()).toBe('');
    }, TIMEOUT);

    it('sends a request and shows what it answered with, naming the version it was sent for', async () => {
        await open();
        await expand(HEALTH_LIVE);

        const sent: Promise<Request> = page.waitForRequest(request => request.url().endsWith('/health/live'));
        expect(await execute(HEALTH_LIVE)).toBe('200 OK');

        expect((await sent).headers()['x-version']).toBe(version);
        expect(JSON.parse(await page.locator(`#${HEALTH_LIVE}-result-body`).textContent() ?? '')).toEqual({ status: 'ok' });
        expect(await page.locator(`#${HEALTH_LIVE}-result-url`).textContent()).toBe(`${baseUrl}/health/live`);
        expect(await page.locator(`#${HEALTH_LIVE}-result-curl`).textContent()).toContain(`curl -X GET '${baseUrl}/health/live'`);
        expect(await page.locator(`#${HEALTH_LIVE}-result-headers`).textContent()).toContain('content-type: application/json');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('sends the query parameters entered, and shows the error the application answers with', async () => {
        await open();
        await expand(TEMPLATE_LOG);

        await page.locator(`#${TEMPLATE_LOG}-parameter-query-level`).fill('99');
        expect(await execute(TEMPLATE_LOG)).toBe('400 Bad Request');

        expect(await page.locator(`#${TEMPLATE_LOG}-result-url`).textContent()).toBe(`${baseUrl}/templates/log?level=99`);
        expect(await page.locator(`#${TEMPLATE_LOG}-result-body`).textContent()).toContain('level');
    }, TIMEOUT);

    it('names a required parameter left empty, and sends nothing', async () => {
        await open();
        await expand(TEMPLATE_LOG);

        let requests: number = 0;
        page.on('request', request => {
            if (request.url().includes('/templates/log')) {
                requests++;
            }
        });
        await page.locator(`#${TEMPLATE_LOG}-execute`).click();
        await page.locator(`#${TEMPLATE_LOG}-result-error`).waitFor({ state: 'visible' });

        expect(await page.locator(`#${TEMPLATE_LOG}-result-error`).textContent()).toBe('Required: level');
        expect(requests).toBe(0);
    }, TIMEOUT);

    it('logs in with a json body, and sends the token entered under authorize with a request that requires a login', async () => {
        const { email, password } = await createUser();
        await open();
        await expand(LOGIN);
        await page.locator(`#${LOGIN}-body-application-json`).fill(JSON.stringify({ email, password }));
        expect(await execute(LOGIN)).toBe('200 OK');
        const answer: LoginAnswer = JSON.parse(await page.locator(`#${LOGIN}-result-body`).textContent() ?? '');
        const { accessToken } = answer;

        await expand(LOGINS);
        expect(await execute(LOGINS)).toBe('401 Unauthorized');

        await page.locator('#explorer-authorize').click();
        await page.locator('#explorer-authorize-jwt').fill(accessToken.value);
        await page.locator('#explorer-authorize-save').click();
        expect(await page.locator('#explorer-authorize').textContent()).toBe('Authorized');

        const sent: Promise<Request> = page.waitForRequest(request => request.url().endsWith('/auth/logins'));
        expect(await execute(LOGINS)).toBe('200 OK');
        expect((await sent).headers()['authorization']).toBe(`Bearer ${accessToken.value}`);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('names the operation opened in the address, and its tag once it is closed again', async () => {
        await open();

        await expand(HEALTH_LIVE);
        expect(new URL(page.url()).hash).toBe(`#${HEALTH_LIVE}`);

        await page.locator(`#${HEALTH_LIVE} > summary`).click();
        expect(new URL(page.url()).hash).toBe('#tag-HealthController');

        await page.locator('#tag-HealthController > summary').click();
        expect(new URL(page.url()).hash).toBe('');
        expect(new URL(page.url()).pathname).toBe('/explorer');
    }, TIMEOUT);

    it('opens the operation a link names, and scrolls to it', async () => {
        await open(`/explorer#${FILE_UPLOAD}`);

        expect(await page.locator(`#${FILE_UPLOAD}`).getAttribute('open')).not.toBeNull();
        await expect(page.locator(`#${FILE_UPLOAD}-path`).evaluate(element => {
            const { top, bottom } = element.getBoundingClientRect();
            return top >= 0 && bottom <= window.innerHeight;
        })).resolves.toBe(true);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('opens the AsyncAPI tab for a link to an event', async () => {
        await open(`/explorer#${CHAT_MESSAGE}`);

        expect(await page.locator('#button-asyncapi').getAttribute('aria-selected')).toBe('true');
        expect(await page.locator(`#${CHAT_MESSAGE}`).getAttribute('open')).not.toBeNull();
        expect(await page.locator(`#${CHAT_MESSAGE}-address`).isVisible()).toBe(true);
    }, TIMEOUT);

    it('opens the authorize dialog in the middle of the screen', async () => {
        await open();
        await page.locator('#explorer-authorize').click();

        const dialog: { x: number, y: number, width: number, height: number } | null = await page.locator('#explorer-authorize-dialog').boundingBox();
        const viewport: { width: number, height: number } | null = page.viewportSize();
        assert(dialog && viewport);
        expect(Math.abs(dialog.x + dialog.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(dialog.y + dialog.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);
    }, TIMEOUT);

    it('keeps what was entered under authorize across a reload, until logged out', async () => {
        await open();
        await page.locator('#explorer-authorize').click();
        await page.locator('#explorer-authorize-jwt').fill('a token');
        await page.locator('#explorer-authorize-save').click();

        await page.reload();
        await page.locator('#explorer-authorize').click();
        expect(await page.locator('#explorer-authorize-jwt').inputValue()).toBe('a token');
        expect(await page.locator('#explorer-authorize').textContent()).toBe('Authorized');
        expect(await page.locator('#explorer-authorize-lock-closed').isVisible()).toBe(true);
        expect(await page.locator('#explorer-authorize-lock-open').isVisible()).toBe(false);

        await page.locator('#explorer-authorize-clear').click();
        await page.reload();
        expect(await page.locator('#explorer-authorize').textContent()).toBe('Authorize');
        expect(await page.locator('#explorer-authorize-lock-open').isVisible()).toBe(true);
        expect(await page.locator('#explorer-authorize-lock-closed').isVisible()).toBe(false);
    }, TIMEOUT);

    it('sends a form body with the file chosen', async () => {
        await open();
        await expand(FILE_UPLOAD);
        expect(await page.locator(`#${FILE_UPLOAD}-body-type`).inputValue()).toBe('multipart/form-data');
        expect(await page.locator(`#${FILE_UPLOAD}-field-multipart-form-data-file`).isEnabled()).toBe(true);

        await page.locator(`#${FILE_UPLOAD}-field-multipart-form-data-file`).setInputFiles({
            name: 'notes.json',
            mimeType: 'application/json',
            buffer: Buffer.from('{"notes":true}')
        });
        const sent: Promise<Request> = page.waitForRequest(request => request.url().endsWith('/files/') && request.method() === 'POST');
        const answered: Promise<PlaywrightResponse> = page.waitForResponse(response => response.url().endsWith('/files/'));
        expect(await execute(FILE_UPLOAD)).toBe('200 OK');

        const request: Request = await sent;
        const disposition: string = (await answered).headers()['content-disposition'] ?? '';
        expect(request.headers()['content-type']).toContain('multipart/form-data');
        expect(request.postData()).toContain('{"notes":true}');
        expect(await page.locator(`#${FILE_UPLOAD}-result-curl`).textContent()).toContain('-F \'file=@notes.json\'');
        // the file is answered back as an attachment, which is offered to download rather than shown
        expect(await page.locator(`#${FILE_UPLOAD}-result-download`).isVisible()).toBe(true);
        expect(disposition).toMatch(/^attachment; filename="[^"]+\.json"/);
        expect(disposition).toContain(`filename="${await page.locator(`#${FILE_UPLOAD}-result-download`).getAttribute('download')}"`);
        expect(await page.locator(`#${FILE_UPLOAD}-result-body`).isVisible()).toBe(false);
    }, TIMEOUT);

    it('answers with a 404 for a version the application does not have', async () => {
        const response: Response = await fetch(`${appUrl}/explorer/9.9.9`);
        expect(response.status).toBe(404);
    }, TIMEOUT);
});

/**
 * An AsyncAPI document describing no event, as a service of an application's own may answer.
 */
class NoEventsAsyncApiService extends AsyncApiService {
    override async createAsyncApiDefinition(app: ZibriApplication, version: Version): Promise<AsyncApiDefinition> {
        const definition: AsyncApiDefinition = await super.createAsyncApiDefinition(app, version);
        return { ...definition, channels: {}, operations: {} };
    }
}

describe('the OpenAPI explorer of an application whose AsyncAPI document describes nothing, in a browser', () => {
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let browser: PageBrowser;

    beforeAll(async () => {
        server = await startTestServer({
            application: {
                ...testApplicationOptions,
                providers: [
                    ...testApplicationOptions.providers ?? [],
                    defineProvider({ token: ZIBRI_DI_TOKENS.ASYNC_API_SERVICE, useClass: NoEventsAsyncApiService })
                ]
            }
        });
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl: await server.start() } });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('shows the OpenAPI document without a tab bar, and no link to the AsyncAPI document', async () => {
        const page: Page = await browser.open(`${baseUrl}/explorer`);

        expect(await page.locator('[role="tablist"]').count()).toBe(0);
        expect(await page.locator('#explorer-asyncapi-document').count()).toBe(0);
        expect(await page.locator(`#${HEALTH_LIVE}-path`).isVisible()).toBe(true);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);
});

describe('the OpenAPI explorer of an application naming several servers, in a browser', () => {
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let browser: PageBrowser;

    beforeAll(async () => {
        server = await startTestServer({
            application: {
                ...testApplicationOptions,
                providers: [
                    ...testApplicationOptions.providers ?? [],
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.OPEN_API_SERVERS,
                        // a factory, as $ts needs the application started
                        useFactory: () => [
                            { url: '/', description: $ts`This application` },
                            { url: 'https://api.example.com', description: $ts`Production` }
                        ]
                    })
                ]
            }
        });
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl: await server.start() } });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('lets the user choose the server, showing the description of the one chosen', async () => {
        const page: Page = await browser.open(`${baseUrl}/explorer`);

        expect(await page.locator('#explorer-server-url').count()).toBe(0);
        expect(await page.locator('#explorer-server').inputValue()).toBe('/');
        expect(await page.locator('#explorer-server-description-0').isVisible()).toBe(true);
        expect(await page.locator('#explorer-server-description-1').isVisible()).toBe(false);

        await page.locator('#explorer-server').selectOption('https://api.example.com');

        expect(await page.locator('#explorer-server-description-0').isVisible()).toBe(false);
        expect(await page.locator('#explorer-server-description-1').textContent()).toBe('Production');
        expect(await page.locator('#explorer-server-description-1').isVisible()).toBe(true);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);
});
