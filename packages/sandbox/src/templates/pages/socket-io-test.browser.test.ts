import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from '../../__testing__/test-application-options';

type SocketStub = {
    sent: unknown[],
    receive: (event: string, message: unknown) => void
};

declare global {
    // eslint-disable-next-line typescript/consistent-type-definitions
    interface Window {
        socket: SocketStub,
        socketAnswer?: unknown
    }
}

const TIMEOUT: number = 30000;

// the page is what is tested here, not the connection, so the browser gets a socket that hands a
// message to the page when the test says so and acknowledges everything the page sends
const SOCKET_STUB: string = `window.io = () => {
    const handlers = {};
    const socket = {
        id: 'me',
        auth: { offset: 0 },
        sent: [],
        on: (event, handler) => { handlers[event] = handler; },
        onAny: () => {},
        timeout: () => socket,
        emitWithAck: (event, payload) => { socket.sent.push(payload); return Promise.resolve(window.socketAnswer ?? { ok: true }); },
        receive: (event, message) => handlers[event](message)
    };
    window.socket = socket;
    return socket;
};`;

describe('the socket io test page, in a browser', () => {
    let server: StartedTestServer;
    let appUrl: string;
    let browser: PageBrowser;
    let page: Page;

    beforeAll(async () => {
        server = await startTestServer({ application: testApplicationOptions });
        appUrl = await server.start();
        browser = await startPageBrowser();
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    async function open(): Promise<void> {
        page = await browser.open(`${appUrl}/templates/socket`, async opened => {
            await opened.route(
                url => url.pathname === '/assets/vendor/socket-io-client.js',
                route => route.fulfill({ contentType: 'text/javascript', body: SOCKET_STUB })
            );
        });
    }

    it('shows a received message as text, whatever it holds', async () => {
        const message: string = '<img src="x" onerror="window.injected = true">';
        await open();

        await page.evaluate(
            text => window.socket.receive('chat message', { data: { message: text }, senderConnectionId: 'other', senderUserId: 'u1' }),
            message
        );

        expect(await page.locator('#messages img').count()).toBe(0);
        expect(await page.locator('#messages li').innerText()).toContain(message);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('sends what was typed and empties the input', async () => {
        await open();

        await page.locator('#input').fill('hello');
        await page.locator('#send-button').click();
        await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('#input')?.value === '');

        const sent: unknown[] = await page.evaluate(() => window.socket.sent);
        expect(sent).toEqual([{ headers: { Authorization: 'Bearer 12376892311' }, body: { message: 'hello' } }]);
    }, TIMEOUT);

    it('opens the dialog with the error when the message is refused', async () => {
        await open();
        await page.evaluate(() => {
            window.socketAnswer = { ok: false, error: { status: 403, paragraphs: ['Not allowed'] } };
        });

        await page.locator('#input').fill('hello');
        await page.locator('#send-button').click();
        await page.locator('#dialog').waitFor({ state: 'visible' });

        expect(await page.locator('#error-dialog-title').textContent()).toBe('Error: 403');
        expect(await page.locator('#error-paragraphs').textContent()).toBe('Not allowed');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);
});
