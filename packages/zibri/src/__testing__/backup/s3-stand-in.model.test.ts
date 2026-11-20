import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { testFileFolder } from '../constants';
import { S3StandIn } from './s3-stand-in.model';

const standIn: S3StandIn = new S3StandIn(FsUtilities.getPath(testFileFolder, `s3-stand-in-${UUIDUtilities.generate()}`));

beforeAll(async () => {
    await standIn.start();
});

afterAll(async () => {
    await standIn.stop();
});

describe('S3StandIn', () => {
    // as a transport does that refuses an object larger than it may hold, or a reader that is done early
    it('goes on answering once a client stops reading an object part way', async () => {
        const object: Uint8Array<ArrayBuffer> = new Uint8Array(64 * 1024 * 1024).fill(1);
        expect((await fetch(`${standIn.getEndpoint()}/backups/large`, { method: 'PUT', body: object })).ok).toBe(true);

        const response: Response = await fetch(`${standIn.getEndpoint()}/backups/large`);
        await response.body?.cancel();
        // until the stand-in has seen the connection end, while it was still sending
        await wait(500);

        const next: Response = await fetch(`${standIn.getEndpoint()}/backups/missing`);
        expect(next.status).toBe(404);
    }, 30_000);
});