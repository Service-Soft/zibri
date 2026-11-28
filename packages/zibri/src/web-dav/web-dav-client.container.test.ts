import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../__testing__/constants';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { GlobalRegistry } from '../global/global-registry';
import { Ms } from '../utilities/ms';
import { WebDavClient } from './web-dav-client';
import { describeWebDavClient } from './web-dav-client.cases';

// against a real WebDAV server, Apache's mod_dav, in a container. How the client reads answers and which hosts a
// tenant's connection reaches is held by web-dav-client.answers.test.ts, and what Nextcloud does on top by
// web-dav-client.nextcloud.test.ts

let server: StartedWebDavTestServer | undefined;

beforeAll(async () => {
    // the errors of the http client carry translated messages, which an application not created refuses to build
    GlobalRegistry.markAppAsCreated();
    WebDavTestServerUtilities.initContainer();
    server = await WebDavTestServerUtilities.startApache({ username: 'ada', password: 'Lovelace-1815' });
}, TestTimeouts.apache.start);

afterAll(async () => {
    await server?.stop();
}, TestTimeouts.apache.stop);

describeWebDavClient('Apache', () => {
    if (server == undefined) {
        throw new Error('The WebDAV server did not start.');
    }
    return new WebDavClient({ connection: server.connection, network: undefined, timeoutInMs: Ms.SECOND * 30 });
// its ETags are of the content, FileETag Digest
}, 'per-write');