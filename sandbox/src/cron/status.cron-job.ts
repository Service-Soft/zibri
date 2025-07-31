import { CronJob, inject, Injectable, LoggerInterface, ZIBRI_DI_TOKENS, InitialCronConfig } from 'zibri';

@Injectable()
export class StatusCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Status',
        cron: '* * * * * *'
    };

    async onTick(): Promise<void> {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).info(`is running ${this.name}`);
    }
}