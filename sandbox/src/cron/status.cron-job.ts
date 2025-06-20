import { CronConfig, CronJob, inject, Injectable, LoggerInterface, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable()
export class StatusCronJob extends CronJob {
    readonly initialConfig: Partial<CronConfig> & Pick<CronConfig, | 'cron' | 'name'> = {
        name: 'Status',
        cron: '* * * * * *'
    };

    onTick(): void {
        inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).info('is running', this.name);
    }
}