import assert from 'node:assert';
import { createServer, IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { S3BackupTransportOptions } from './s3/s3-backup-transport-options.model';
import { S3Credentials } from './s3/s3-credentials.model';
import { S3SignatureUtilities } from './s3/s3-signature.utilities';
import { BaseS3BackupTransport } from './s3.backup-transport';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupTransport } from '../decorators/backup-transport.decorator';

// evaluation/round-2/02-data-layer-stores.md S8: the transport signed with a static access key and its
// secret alone, which is what a workload with expiring credentials does not have, asked for no
// encryption, and sent no digest of what it uploaded, which a bucket with object lock refuses

/**
 * A request the service below was sent.
 */
type ReceivedRequest = {
    /**
     * Its method.
     */
    method: string,
    /**
     * Its path and query.
     */
    url: string,
    /**
     * Its headers.
     */
    headers: IncomingHttpHeaders,
    /**
     * Its body.
     */
    body: Buffer
};

/**
 * Every request the service below was sent, in order.
 */
const received: ReceivedRequest[] = [];

/**
 * How often the credentials below were asked for.
 */
let resolved: number = 0;

// only known once the service below listens, which is after the transports are declared
let endpoint: string = '';

/**
 * Credentials that expire, as a role assumed by a workload hands them out: a new session token each time.
 * @returns The credentials.
 */
// eslint-disable-next-line typescript/require-await
async function resolveTemporaryCredentials(): Promise<S3Credentials> {
    resolved++;
    return { accessKeyId: 'temporary-key', secretAccessKey: 'temporary-secret', sessionToken: `session-${resolved}` };
}

/**
 * The options every transport below shares.
 * @returns The options.
 */
function resolveSharedOptions(): Pick<S3BackupTransportOptions, 'endpoint' | 'bucket' | 'region' | 'addressingStyle' | 'partSize'> {
    // the smallest part the protocol allows, so that a few megabytes are already several parts
    return { endpoint, bucket: 'backups', region: 'us-east-1', addressingStyle: 'path', partSize: '5mb' };
}

@BackupTransport()
class TemporaryCredentialsS3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 'temporary-credentials-s3-backup-transport';
    protected override get options(): S3BackupTransportOptions {
        return { ...resolveSharedOptions(), credentials: resolveTemporaryCredentials, serverSideEncryption: 'bucket-default' };
    }
}

@BackupTransport()
class StaticCredentialsS3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 'static-credentials-s3-backup-transport';
    protected override get options(): S3BackupTransportOptions {
        return {
            ...resolveSharedOptions(),
            credentials: { accessKeyId: 'static-key', secretAccessKey: 'static-secret' },
            serverSideEncryption: 'bucket-default'
        };
    }
}

@BackupTransport()
class KmsEncryptedS3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 'kms-encrypted-s3-backup-transport';
    protected override get options(): S3BackupTransportOptions {
        return {
            ...resolveSharedOptions(),
            credentials: { accessKeyId: 'static-key', secretAccessKey: 'static-secret' },
            serverSideEncryption: { algorithm: 'aws:kms', keyId: 'backup-key' }
        };
    }
}

/**
 * The names of the headers a request's signature covers.
 * @param request - The request.
 * @returns The names, as its authorization lists them.
 */
function resolveSignedHeaders(request: ReceivedRequest): string[] {
    return /SignedHeaders=([^,]+)/.exec(request.headers.authorization ?? '')?.[1]?.split(';') ?? [];
}

/**
 * Data the transports upload in two parts: one as large as a part, and the rest.
 * @returns The chunks it is read in.
 */
function resolveTwoParts(): Buffer[] {
    return [Buffer.alloc(5 * 1024 * 1024, 1), Buffer.alloc(1024 * 1024, 2)];
}

/**
 * Records a request and answers it.
 * @param request - The request.
 * @param response - Where the answer goes.
 */
async function record(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const recorded: ReceivedRequest = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: await buffer(request) };
    received.push(recorded);
    answer(recorded, response);
}

/**
 * Answers a request the way an S3 compatible service does, for the requests an upload is made of.
 * @param request - The request.
 * @param response - Where the answer goes.
 */
function answer(request: ReceivedRequest, response: ServerResponse): void {
    if (request.method === 'POST' && request.url.endsWith('?uploads')) {
        response.writeHead(200).end('<InitiateMultipartUploadResult><UploadId>an-upload</UploadId></InitiateMultipartUploadResult>');
        return;
    }
    if (request.method === 'POST') {
        response.writeHead(200).end('<CompleteMultipartUploadResult><ETag>"whole"</ETag></CompleteMultipartUploadResult>');
        return;
    }
    response.writeHead(200, { etag: `"part-${received.length}"` }).end();
}

describe('BaseS3BackupTransport — what it sends', () => {
    let service: Server;
    let server: StartedTestServer;
    const backup: BackupEntity = Object.assign(new BackupEntity(), { name: 'sent' });
    const resource: BackupResourceEntity = Object.assign(new BackupResourceEntity(), { name: 'Data' });

    beforeAll(async () => {
        // a service that takes everything and records what it was sent: what is asserted is what the
        // transport sends, which a real service would only answer with a refusal
        service = createServer((request: IncomingMessage, response: ServerResponse) => {
            void record(request, response);
        });
        await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve));
        const address: string | AddressInfo | null = service.address();
        assert(address != undefined && typeof address !== 'string', 'the service is not listening on a port');
        endpoint = `http://127.0.0.1:${address.port}`;
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
    }, TestTimeouts.inMemory.start);

    beforeEach(() => {
        received.length = 0;
        resolved = 0;
    });

    afterAll(async () => {
        await server?.shutdown();
        await new Promise<void>(resolve => service.close(() => resolve()));
    }, TestTimeouts.inMemory.shutdown);

    it('signs every request with the credentials resolved for it, session token included', async () => {
        await inject(TemporaryCredentialsS3BackupTransport).storeMetadata(backup, '{}');
        await inject(TemporaryCredentialsS3BackupTransport).storeMetadata(backup, '{}');

        expect(received.map(r => r.headers['x-amz-security-token'])).toEqual(['session-1', 'session-2']);
        expect(received.map(r => r.headers.authorization)).toEqual([
            expect.stringContaining('Credential=temporary-key/'),
            expect.stringContaining('Credential=temporary-key/')
        ]);
        expect(received.map(r => resolveSignedHeaders(r))).toEqual([
            expect.arrayContaining(['x-amz-security-token']),
            expect.arrayContaining(['x-amz-security-token'])
        ]);
    }, 15000);

    it('sends no session token with credentials that have none', async () => {
        await inject(StaticCredentialsS3BackupTransport).storeMetadata(backup, '{}');

        expect(received).toHaveLength(1);
        expect(received[0]?.headers['x-amz-security-token']).toBeUndefined();
        expect(received[0]?.headers.authorization).toContain('Credential=static-key/');
    }, 15000);

    it('sends the digest of every body it uploads, whole or in parts, under its signature', async () => {
        await inject(StaticCredentialsS3BackupTransport).storeData(Readable.from(resolveTwoParts()), backup, resource);
        await inject(StaticCredentialsS3BackupTransport).storeMetadata(backup, '{}');

        const uploads: ReceivedRequest[] = received.filter(r => r.method === 'PUT');
        // two parts and the record
        expect(uploads).toHaveLength(3);
        for (const upload of uploads) {
            expect(upload.headers['content-md5']).toBe(S3SignatureUtilities.resolveContentMd5(upload.body));
            expect(resolveSignedHeaders(upload)).toContain('content-md5');
        }
    }, 15000);

    it('asks for the encryption it names wherever an object is started, under its signature', async () => {
        await inject(KmsEncryptedS3BackupTransport).storeData(Readable.from(resolveTwoParts()), backup, resource);
        await inject(KmsEncryptedS3BackupTransport).storeMetadata(backup, '{}');

        // the upload in parts is started by the first request, the record is one request of its own
        const started: ReceivedRequest[] = received.filter(r => r.url.endsWith('?uploads') || r.url.endsWith('metadata.json'));
        expect(started).toHaveLength(2);
        for (const request of started) {
            expect(request.headers['x-amz-server-side-encryption']).toBe('aws:kms');
            expect(request.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe('backup-key');
            expect(resolveSignedHeaders(request)).toEqual(
                expect.arrayContaining(['x-amz-server-side-encryption', 'x-amz-server-side-encryption-aws-kms-key-id'])
            );
        }
        // the parts belong to the upload, which already says how it is encrypted
        expect(received.filter(r => r.url.includes('partNumber')).map(r => r.headers['x-amz-server-side-encryption'])).toEqual([undefined, undefined]);
    }, 15000);

    it('asks for no encryption of its own when the bucket\'s default decides', async () => {
        await inject(StaticCredentialsS3BackupTransport).storeMetadata(backup, '{}');

        expect(received[0]?.headers['x-amz-server-side-encryption']).toBeUndefined();
    }, 15000);
});