import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { S3StandIn } from '../../__testing__/backup/s3-stand-in.model';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BackupEntity } from '../backup-entity.model';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { describeBackupTransport } from './backup-transport.cases';
import { Format1BackupTransport } from './format-1.backup-transport';
import { S3BackupTransport } from './s3.backup-transport';

// against the stand-in, which runs wherever the suites run: what is checked is what the store asks of
// a bucket. What a real service accepts of it, such as its signatures and digests, is checked against
// one in base-s3.backup-transport.test.ts

const standIn: S3StandIn = new S3StandIn(FsUtilities.getPath(testFileFolder, `s3-backup-transport-${UUIDUtilities.generate()}`));
let server: StartedTestServer | undefined;

beforeAll(async () => {
    await standIn.start();
    // the store sends through the application's http client
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await standIn.stop();
}, TestTimeouts.inMemory.shutdown);

describeBackupTransport('S3BackupTransport', () => new S3BackupTransport('s3-backup-transport', {
    endpoint: standIn.getEndpoint(),
    bucket: 'backups',
    region: 'us-east-1',
    credentials: { accessKeyId: 'stand-in', secretAccessKey: 'stand-in' },
    serverSideEncryption: 'bucket-default',
    prefix: 'app',
    addressingStyle: 'path'
}));

describe('S3BackupTransport, in a bucket with folders a console created', () => {
    it('finds the backups beside them, and no name or key in them', async () => {
        const prefix: string = `console-${UUIDUtilities.generate()}`;
        const store: S3BackupTransport = new S3BackupTransport('s3-backup-transport-console', {
            endpoint: standIn.getEndpoint(),
            bucket: 'backups',
            region: 'us-east-1',
            credentials: { accessKeyId: 'stand-in', secretAccessKey: 'stand-in' },
            serverSideEncryption: 'bucket-default',
            prefix,
            addressingStyle: 'path'
        });
        // what a console creates for a folder: an empty object under the folder's key, with a "/" at its
        // end. One for the prefix itself, and one for a folder below it
        for (const key of [`${prefix}/`, `${prefix}/a-folder/`]) {
            const response: Response = await fetch(`${standIn.getEndpoint()}/backups/${key}`, { method: 'PUT', body: '' });
            expect(response.ok).toBe(true);
        }
        const transport: Format1BackupTransport = new Format1BackupTransport(store);
        // eslint-disable-next-line typescript/no-deprecated -- a backup of format 1, which 3.x keeps until 4.0
        await transport.storeMetadata(Object.assign(new BackupEntity(), { name: 'stored' }), '{"name":"stored"}');

        const session: BackupTransportSessionInterface = await store.openSession();
        const names: string[] = [];
        const keys: string[] = [];
        for await (const page of session.findNames('')) {
            names.push(...page);
        }
        for await (const page of session.findKeys('')) {
            keys.push(...page);
        }
        await session.close();

        // eslint-disable-next-line typescript/no-deprecated -- a backup of format 1, which 3.x keeps until 4.0
        expect(await transport.resolveBackups([])).toEqual(['{"name":"stored"}']);
        expect(names.sort()).toEqual(['a-folder', 'stored']);
        expect(keys).toEqual(['stored/metadata.json']);
    });
});