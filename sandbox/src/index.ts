import H from 'handlebars/runtime';
import { inject, isVersion, JwtAuthController, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication, EmailConfigInput } from 'zibri';

import { CronController, FileController, MetricsController, TemplateController, TestController } from './controllers';
import { DbDataSource } from './data-sources';
import { version } from '../package.json';
import { StatusCronJob } from './cron';

export let logger: LoggerInterface;

async function start(): Promise<void> {

    if (!isVersion(version)) {
        throw new Error('The version of the package.json is not valid.');
    }

    const app: ZibriApplication = new ZibriApplication({
        name: 'Api',
        baseUrl: 'http://localhost:3000',
        controllers: [
            TestController,
            FileController,
            TemplateController,
            CronController,
            JwtAuthController,
            MetricsController
        ],
        dataSources: [DbDataSource],
        cronJobs: [StatusCronJob],
        version,
        providers: [
            {
                token: ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET,
                useFactory: () => 'test'
            },
            {
                token: ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET,
                useFactory: () => 'test'
            },
            {
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useFactory: (): EmailConfigInput => {
                    return {
                        maxEmailsPerHour: 0,
                        defaultSender: 'Max Mustermann',
                        host: '',
                        port: 0,
                        auth: {
                            user: '',
                            pass: ''
                        }
                    };
                }
            },
            {
                token: ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL,
                useFactory: () => 'http://localhost:4200/confirm-password-reset'
            }
        ]
    });
    await app.init(H);

    logger = inject(ZIBRI_DI_TOKENS.LOGGER);

    app.start(3000);
}

void start();