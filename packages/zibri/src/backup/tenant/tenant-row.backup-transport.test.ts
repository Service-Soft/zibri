import { createServer, RequestListener, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { S3TenantBackupTransportKind } from './s3.tenant-backup-transport-kind';
import { TenantBackupTransportOptions } from './tenant-backup-transport-options.model';
import { TenantBackupTransport } from './tenant-backup-transport.model';
import { TenantRowBackupTransport } from './tenant-row.backup-transport';
import { TenantS3TransportSettings } from './tenant-s3-transport-settings.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BackupTransportSessionInterface } from '../transports/backup-transport-session.interface';

/**
 * What a tenant's bucket may lead the requests to: its bucket named in the host or in a redirect, held to
 * what the endpoint is held to.
 */

/**
 * What a tenant's transport may reach, as an application has it by default.
 */
const PUBLIC_ONLY: TenantBackupTransportOptions = { kinds: [new S3TenantBackupTransportKind()], allowedHosts: undefined, allowPrivateNetworks: false };

/**
 * A tenant's transport to a bucket.
 * @param s3 - Where the bucket is, over the settings every case shares.
 * @returns The transport, its secret decrypted.
 */
function resolveTransport(s3: Partial<TenantS3TransportSettings>): TenantBackupTransport {
    const settings: TenantS3TransportSettings = {
        endpoint: 'https://8.8.8.8',
        bucket: 'backups',
        region: 'us-east-1',
        accessKeyId: 'tenant-key',
        addressingStyle: 'path',
        ...s3
    };
    return Object.assign(new TenantBackupTransport(), {
        id: UUIDUtilities.generate(),
        name: 'tenant bucket',
        kind: 's3',
        settings: { ...settings },
        secret: JsonUtilities.stringify({ secretAccessKey: 'tenant-secret' })
    });
}

/**
 * Opens a session of a tenant's store and closes it again.
 * @param store - The store.
 */
async function openAndClose(store: TenantRowBackupTransport): Promise<void> {
    const session: BackupTransportSessionInterface = await store.openSession();
    await session.close();
}

/**
 * Starts a server on a free port of this machine.
 * @param answer - What it answers every request with.
 * @returns The server and its port.
 */
async function listen(answer: RequestListener): Promise<[Server, number]> {
    const server: Server = createServer(answer);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address: string | AddressInfo | null = server.address();
    if (address == undefined || typeof address === 'string') {
        throw new Error('The server listens on no port.');
    }
    return [server, address.port];
}

let server: StartedTestServer | undefined;
// the bucket a tenant configured, which answers everything with a redirect to the server inside
let redirecting: Server | undefined;
let redirectingPort: number = 0;
let inside: Server | undefined;
let insidePort: number = 0;
let insideRequests: number = 0;

beforeAll(async () => {
    [inside, insidePort] = await listen((_request, response) => {
        insideRequests++;
        response.writeHead(HttpStatus.OK).end();
    });
    [redirecting, redirectingPort] = await listen((request, response) => {
        // drained first, so that the client is done sending before it reads the redirect
        request.resume();
        request.once('end', () => {
            response.writeHead(HttpStatus.TEMPORARY_REDIRECT, { [KnownHeader.LOCATION]: `http://localhost:${insidePort}${request.url ?? '/'}` }).end();
        });
    });
    // the store sends through the application's http client
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    for (const started of [redirecting, inside]) {
        started?.closeAllConnections();
        await new Promise<void>(resolve => started?.close(() => resolve()) ?? resolve());
    }
}, TestTimeouts.inMemory.shutdown);

describe('TenantRowBackupTransport, a bucket', () => {
    it('refuses a bucket holding anything a bucket name cannot, which would lead the requests to another host or port', async () => {
        for (const bucket of ['10.0.0.5:8443/', 'internal.corp/', 'a b', '']) {
            for (const addressingStyle of ['virtual-hosted', 'path'] as const) {
                await expect(openAndClose(new TenantRowBackupTransport(resolveTransport({ bucket, addressingStyle }), PUBLIC_ONLY)))
                    .rejects.toThrow('needs to be letters, digits');
            }
        }
        // a name of the rules AWS had before its current ones, which some buckets still have
        await expect(openAndClose(new TenantRowBackupTransport(resolveTransport({ bucket: 'Legacy_Bucket.name-1' }), PUBLIC_ONLY))).resolves.toBeUndefined();
    });

    it('checks the host a bucket named in the host is reached at, rather than the endpoint\'s', async () => {
        const options: TenantBackupTransportOptions = {
            kinds: [new S3TenantBackupTransportKind()],
            allowedHosts: ['backups.storage.example.com'],
            allowPrivateNetworks: true
        };
        const virtualHosted: Partial<TenantS3TransportSettings> = { endpoint: 'https://storage.example.com', addressingStyle: 'virtual-hosted' };

        await expect(openAndClose(new TenantRowBackupTransport(resolveTransport({ ...virtualHosted, bucket: 'backups' }), options))).resolves.toBeUndefined();
        await expect(openAndClose(new TenantRowBackupTransport(resolveTransport({ ...virtualHosted, bucket: 'other' }), options)))
            .rejects.toThrow('"other.storage.example.com" needs to be one of');
    });

    it('follows no redirect to a host it may not reach, and sends nothing there', async () => {
        const store: TenantRowBackupTransport = new TenantRowBackupTransport(
            resolveTransport({ endpoint: `http://127.0.0.1:${redirectingPort}` }),
            { kinds: [new S3TenantBackupTransportKind()], allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true }
        );
        const session: BackupTransportSessionInterface = await store.openSession();
        try {
            await expect(session.put('probe', Readable.from([Buffer.from('zibri')]))).rejects.toThrow('"localhost" needs to be one of');
            await expect(session.get('probe', 1024)).rejects.toThrow('"localhost" needs to be one of');
        }
        finally {
            await session.close();
        }

        expect(insideRequests).toBe(0);
    });
});