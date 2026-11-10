import { defineProvider, FsUtilities, ZIBRI_DI_TOKENS } from 'zibri';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { applicationOptions } from '../application-options';

/**
 * Starts the site as a test server, with its own providers and one more: the assets read from the folder of the site,
 * as there is no bundle beside which the build copied them.
 * @returns The server, not yet listening.
 */
export async function startDocsSite(): Promise<StartedTestServer> {
    return await startTestServer({
        application: {
            ...applicationOptions,
            providers: [
                ...applicationOptions.providers ?? [],
                defineProvider({ token: ZIBRI_DI_TOKENS.ASSETS_PATH, useFactory: () => FsUtilities.getPath(process.cwd(), 'assets') })
            ]
        }
    });
}