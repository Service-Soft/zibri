import { WebsocketMessage } from './models/websocket-message.model';
import { type WebsocketOptions } from './models/websocket-options.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * Deletes the websocket messages that are older than `messageRetentionInMs`.
 */
export class WebsocketMessageCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Websocket Message Cleanup',
        // hourly rather than daily, because a retention of minutes is an ordinary choice here. A
        // message kept a little longer costs room only: a client whose missed messages are gone is
        // told so by what is left, not by when this last ran
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    private readonly retentionInMs: number;

    constructor(
        @InjectRepository(WebsocketMessage)
        private readonly repository: Repository<WebsocketMessage>,
        @Inject(ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS)
        options: WebsocketOptions | undefined
    ) {
        super();
        // registered by the websocket service only for an application that has websockets, which it
        // refuses to start without the options
        if (options == undefined) {
            throw new InternalError('WebsocketMessageCleanupCronJob needs ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT.');
        }
        this.retentionInMs = options.messageRetentionInMs;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.info('cleans up expired websocket messages');
        const [newestExpired] = await this.repository.findAll({
            where: { createdAt: { before: new Date(Date.now() - this.retentionInMs) } },
            order: { seq: 'DESC' },
            take: 1,
            acrossTenants: true
        });
        if (newestExpired == undefined) {
            return;
        }
        // everything up to the newest expired message rather than every expired one: what is kept
        // then always starts right after what was deleted, which is how a replay tells that a client
        // missed messages that are gone. The two only differ for a message stamped by a clock behind
        // the others, which goes a little earlier
        const removed: number = await this.repository.deleteAll(
            { seq: { lesserThanEquals: newestExpired.seq } },
            { acrossTenants: true }
        );
        this.logger.info(`removed ${removed} websocket messages`);
    }
}