import { CronJob, inject, ZIBRI_DI_TOKENS, InitialCronConfig, CronExpression } from 'zibri';

export class StatusCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Status',
        cron: CronExpression.every(1, 'seconds').build(),
        active: false
    };

    async onTick(): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.LOGGER).info(`is running ${this.name}`);
    }
}