import { inject, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

import { applicationOptions } from './application-options';
import { createDefaultData } from './create-default-data.function';
import { DbDataSource } from './data-sources';
import { requireEnv } from './env';

export let logger: LoggerInterface;

async function start(): Promise<void> {
    const app: ZibriApplication = new ZibriApplication(applicationOptions);
    await app.init();

    logger = inject(ZIBRI_DI_TOKENS.LOGGER);

    await createDefaultData(DbDataSource);

    await app.start(Number(requireEnv('PORT')));
}

// eslint-disable-next-line promise/prefer-await-to-callbacks
void start().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});