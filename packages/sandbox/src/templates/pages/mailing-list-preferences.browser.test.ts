import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { inject, MailingList, MailingListServiceInterface, MailingListSubscriber, Repository, repositoryTokenFor, TenantServiceInterface, UUIDUtilities, ZIBRI_DI_TOKENS, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from 'zibri';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from '../../__testing__/test-application-options';

type ApiBehavior = 'answers' | 'fails' | 'is unreachable';

const TIMEOUT: number = 30000;

/**
 * The lists and the subscriber one test runs with.
 */
type Subscription = {
    /**
     * The list the subscriber is on.
     */
    subscribed: MailingList,
    /**
     * A list the subscriber is not on.
     */
    other: MailingList,
    /**
     * The subscriber.
     */
    subscriber: MailingListSubscriber
};

describe('the mailing list preferences page, in a browser', () => {
    const tenant: string = UUIDUtilities.generate();
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;

    beforeAll(async () => {
        server = await startTestServer({ application: testApplicationOptions });
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl: await server.start() } });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
        return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenant, fn);
    }

    async function subscribe(): Promise<Subscription> {
        return await inTenant(async () => {
            const lists: Repository<MailingList> = inject(repositoryTokenFor(MailingList));
            // ids starting with a digit, which is the case a selector built from the id has to survive
            const subscribed: MailingList = await lists.create({ id: `1${UUIDUtilities.generate().slice(1)}`, name: `Subscribed ${UUIDUtilities.generate()}`, subscribers: [] });
            const other: MailingList = await lists.create({ id: `2${UUIDUtilities.generate().slice(1)}`, name: `Other ${UUIDUtilities.generate()}`, subscribers: [] });
            const subscriber: MailingListSubscriber = await inject<Repository<MailingListSubscriber>>(repositoryTokenFor(MailingListSubscriber))
                .create({ email: 'ada@example.com', mailingLists: [subscribed] });
            return { subscribed, other, subscriber };
        });
    }

    async function findSubscribedIds(subscriber: MailingListSubscriber): Promise<Set<string> | undefined> {
        const found: MailingListSubscriber | undefined = await inTenant(async () => await inject<Repository<MailingListSubscriber>>(
            repositoryTokenFor(MailingListSubscriber)
        ).findOne({ where: { id: subscriber.id }, relations: ['mailingLists'], required: false }));
        return found == undefined ? undefined : new Set(found.mailingLists.map(list => list.id));
    }

    async function open({ subscriber }: Subscription, api: ApiBehavior): Promise<void> {
        // the link of the emails, which names the tenant
        const link: string = await inTenant(async () => await inject<MailingListServiceInterface>(
            ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE
        ).resolveManagePreferencesLink(subscriber));
        page = await browser.open(link);
        if (api === 'answers') {
            return;
        }
        // the page sends the update with the method this route answers
        await page.route(request => request.pathname === '/mailing-lists/preferences', async route => {
            if (route.request().method() !== 'PATCH') {
                await route.fallback();
                return;
            }
            await (api === 'fails' ? route.fulfill({ status: 500, body: '{}' }) : route.abort());
        });
    }

    async function toggle(list: MailingList): Promise<void> {
        await page.locator(`[id="${list.id}"]`).click();
    }

    async function isChecked(list: MailingList): Promise<boolean> {
        return await page.locator(`[id="${list.id}"]`).isChecked();
    }

    async function isUpdateDisabled(): Promise<boolean> {
        return await page.locator('#update-button').isDisabled();
    }

    async function update(expectedStatus: string): Promise<void> {
        await page.locator('#update-button').click();
        await page.waitForFunction(
            status => document.querySelector('#status-bar')?.textContent === status,
            expectedStatus
        );
    }

    it('enables update when a list is checked, and saves it', async () => {
        const subscription: Subscription = await subscribe();
        await open(subscription, 'answers');
        await toggle(subscription.other);
        expect(await isUpdateDisabled()).toBe(false);

        await update('preferences updated');

        expect(await findSubscribedIds(subscription.subscriber)).toEqual(new Set([subscription.subscribed.id, subscription.other.id]));
        expect(await isUpdateDisabled()).toBe(true);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('enables update when a list is unchecked, and saves it', async () => {
        const subscription: Subscription = await subscribe();
        await open(subscription, 'answers');
        await toggle(subscription.subscribed);
        expect(await isUpdateDisabled()).toBe(false);

        await update('preferences updated');

        // on no list, the address is forgotten
        expect(await findSubscribedIds(subscription.subscriber)).toBeUndefined();
    }, TIMEOUT);

    it('disables update again when a change is undone', async () => {
        const subscription: Subscription = await subscribe();
        await open(subscription, 'answers');
        await toggle(subscription.other);
        await toggle(subscription.other);

        expect(await isUpdateDisabled()).toBe(true);
    }, TIMEOUT);

    it('puts the checkboxes back when the update fails', async () => {
        const subscription: Subscription = await subscribe();
        await open(subscription, 'fails');
        await toggle(subscription.other);
        await toggle(subscription.subscribed);

        await update('failed updating preferences');

        expect(await isChecked(subscription.other)).toBe(false);
        expect(await isChecked(subscription.subscribed)).toBe(true);
        expect(await isUpdateDisabled()).toBe(true);
    }, TIMEOUT);

    it('compares against what is saved after a failed update, not against what failed', async () => {
        const subscription: Subscription = await subscribe();
        await open(subscription, 'fails');
        await toggle(subscription.other);
        await update('failed updating preferences');

        await toggle(subscription.other);

        expect(await isUpdateDisabled()).toBe(false);
    }, TIMEOUT);

    it('reports a failure when the request does not get through', async () => {
        const subscription: Subscription = await subscribe();
        await open(subscription, 'is unreachable');
        await toggle(subscription.other);

        await update('failed updating preferences');

        expect(await isChecked(subscription.other)).toBe(false);
    }, TIMEOUT);
});