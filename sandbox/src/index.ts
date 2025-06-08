import { inject, isVersion, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

import { JwtController, TestController } from './controllers';
import { DbDataSource } from './data-sources';
import { version } from '../package.json';

export let logger: LoggerInterface;

async function start(): Promise<void> {

    if (!isVersion(version)) {
        throw new Error('The version of the package.json is not valid.');
    }

    const app: ZibriApplication = new ZibriApplication({
        name: 'Api',
        controllers: [TestController, JwtController],
        dataSources: [DbDataSource],
        version,
        providers: [
            {
                token: ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET,
                useFactory: () => 'test'
            },
            {
                token: ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET,
                useFactory: () => 'test'
            }
        ]
    });
    await app.init();

    logger = inject(ZIBRI_DI_TOKENS.LOGGER);

    app.start(3000);
}

void start();