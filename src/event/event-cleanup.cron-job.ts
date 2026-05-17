
import { Event, EventStatus } from './event.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';

/**
 * CronJob that cleans up past events.
 */
export class EventCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Event Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(Event)
        private readonly repository: Repository<Event<unknown>>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.logger.info('cleans up past events');

        try {
            const res: Event<unknown>[] = await this.repository.deleteAll({
                status: EventStatus.FINISHED,
                cleanupAt: { before: new Date() }
            });
            await this.logger.info(`removed ${res.length} events`);
        }
        catch {
            // Do nothing
        }
    }
}