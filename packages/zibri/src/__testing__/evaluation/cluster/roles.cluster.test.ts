import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { FsUtilities } from '../../../utilities/fs.utilities';
import { TestTimeouts } from '../../constants';

/**
 * Executable form of evaluation/03-auth-and-security.md A8, across instances.
 *
 * Roles are rows that change at runtime, and every check reads them from the memory of its own
 * instance. A role written on one instance has to reach the checks of every other, both when it
 * starts carrying a permission and when it stops: within the few seconds the other instances take to
 * apply an invalidation, never only once they restart. The same holds for A9's roles of a tenant's
 * own, which an instance keeps per tenant and is told about per tenant.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'roles.instance-options.ts'),
        instances: 2
    });
}, TestTimeouts.postgres.start * 2);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, TestTimeouts.postgres.shutdown * 2);

/**
 * Asks an instance for what the role carries.
 * @param baseUrl - The instance to ask.
 * @param key - The key of the user holding the role.
 * @returns The status it answered with.
 */
async function readReports(baseUrl: string, key: string): Promise<number> {
    return (await fetch(`${baseUrl}/cluster-roles/reports`, { headers: { 'x-api-key': key } })).status;
}

describe('evaluation/03-auth-and-security A8 - a role written on one instance is checked as written on every other', () => {
    it('lets the holder of a role created on another instance in, and refuses them once it was changed there', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        const setup: Response = await fetch(`${first.baseUrl}/cluster-roles/setup`, { method: 'POST' });
        expect(setup.status).toBe(200);
        const answer: unknown = await setup.json();
        const key: string = typeof answer === 'object' && answer != undefined && 'key' in answer ? String(answer.key) : '';
        // control: the instance that wrote the role knows it at once
        expect(await readReports(first.baseUrl, key)).toBe(200);

        // waited for rather than read once: the other instance is told through the data source
        expect(await running.waitFor(async () => await readReports(second.baseUrl, key), status => status === 200, { timeoutInMs: 10000 })).toBe(200);

        expect((await fetch(`${first.baseUrl}/cluster-roles/revoke`, { method: 'POST' })).status).toBe(204);
        expect(await readReports(first.baseUrl, key)).toBe(403);

        expect(await running.waitFor(async () => await readReports(second.baseUrl, key), status => status === 403, { timeoutInMs: 10000 })).toBe(403);
        // above the usual 15000: each wait is bounded by a real poll interval on another instance
    }, 35000);

    it('lets the member holding a role of their tenant\'s own in, and refuses them once it was changed on another instance', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        const setup: Response = await fetch(`${first.baseUrl}/cluster-roles/tenant-setup`, { method: 'POST' });
        expect(setup.status).toBe(200);
        const answer: unknown = await setup.json();
        const key: string = typeof answer === 'object' && answer != undefined && 'key' in answer ? String(answer.key) : '';
        const tenantId: string = typeof answer === 'object' && answer != undefined && 'tenantId' in answer ? String(answer.tenantId) : '';
        // read once on the second instance, so that what it keeps of the tenant is what has to be told
        expect(await running.waitFor(async () => await readInvoices(second.baseUrl, key), status => status === 200, { timeoutInMs: 10000 })).toBe(200);

        expect((await fetch(`${first.baseUrl}/cluster-roles/tenant-revoke/${tenantId}`, { method: 'POST' })).status).toBe(204);
        expect(await readInvoices(first.baseUrl, key)).toBe(403);

        expect(await running.waitFor(async () => await readInvoices(second.baseUrl, key), status => status === 403, { timeoutInMs: 10000 })).toBe(403);
    }, 35000);
});

/**
 * Asks an instance for what a tenant's own role carries.
 * @param baseUrl - The instance to ask.
 * @param key - The key of the member holding the role, bound to their tenant.
 * @returns The status it answered with.
 */
async function readInvoices(baseUrl: string, key: string): Promise<number> {
    return (await fetch(`${baseUrl}/cluster-roles/invoices`, { headers: { 'x-api-key': key } })).status;
}