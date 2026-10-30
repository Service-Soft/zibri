import { inject, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

import { applicationOptions } from './application-options';
import { createDefaultData } from './create-default-data.function';
import { DbDataSource } from './data-sources';
import { requirePortEnv } from './env';

export let logger: LoggerInterface;

async function start(): Promise<void> {
    const app: ZibriApplication = new ZibriApplication(applicationOptions);
    // "migrate list" and "migrate down <version | migration name>" run in place of starting
    if (await app.runCommand(process.argv.slice(2))) {
        return;
    }
    await app.init();

    logger = inject(ZIBRI_DI_TOKENS.LOGGER);

    await createDefaultData(DbDataSource);

    await app.start(requirePortEnv('PORT'));
}

// eslint-disable-next-line promise/prefer-await-to-callbacks
void start().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});