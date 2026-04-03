import { CronJob, inject, LoggerInterface, ZIBRI_DI_TOKENS, InitialCronConfig } from 'zibri';

export class StatusCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Status',
        cron: '* * * * * *',
        active: false
    };

    async onTick(): Promise<void> {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).info(`is running ${this.name}`);
    }
}