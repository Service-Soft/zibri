import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { Repository } from '../../../data-source/repository/repository.ts';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { type EventServiceInterface } from '../../../event/event-service.interface.ts';
import { Event } from '../../../event/event.model.ts';
import { type OnAppStart } from '../../../global/on-app-start.interface.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Post } from '../../../routing/decorators/post.decorator.ts';

/**
 * What every instance of the heterogeneous event cluster boots with.
 *
 * Unlike events.instance-options.ts, the replicas here are deliberately *not* interchangeable. One
 * plays the web role and the rest play the worker role, and they carry different subscribers for
 * the same event - the shape of every real deployment that splits request handling from background
 * work.
 *
 * Like every instance options module this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance. Which role a process plays is therefore read
 * inside onAppStart rather than here.
 */

/**
 * The event both roles care about, for different reasons.
 */
const eventType: 'order.placed' = 'order.placed' as const;

/**
 * The instance that plays the web role. Every other instance is a worker.
 */
export const webInstanceId: string = 'instance-0';

/**
 * The subscriber the web role registers - writing an audit record.
 */
const auditSubscriberId: string = 'order-auditor';

/**
 * The subscriber the worker role registers - the side effect that actually matters, standing in for
 * the confirmation mail.
 */
const mailSubscriberId: string = 'order-mailer';

declare module '../../../event/event-service.interface.ts' {
    /**
     * The event both roles deal in, declared the way an application declares its own.
     */
    interface ZibriEventMap {
        /**
         * Carries nothing: what this cluster observes is which role ran, which the roles write down
         * themselves.
         */
        'order.placed': {}
    }
}

/**
 * Registers whichever subscriber this instance's role calls for.
 *
 * Both roles subscribe to the same event under *different* subscriber ids, because they are two
 * logical subscribers rather than two copies of one - EventSubscriberRun is keyed by exactly that
 * pair, so a shared id would mean either one running counts for both.
 */
class HeterogeneousRoleSubscriber implements OnAppStart {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {}

    /**
     * Subscribes once this instance is up, under the role it was started as.
     */
    async onAppStart(): Promise<void> {
        const instanceId: string = clusterInstanceId();
        const isWeb: boolean = instanceId === webInstanceId;
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);

        await eventService.subscribe(
            eventType,
            async (event: Event<unknown>) => {
                await this.markRepository.create({
                    instanceId,
                    kind: isWeb ? 'order-audited' : 'order-mailed',
                    tag: event.id,
                    at: new Date()
                });
            },
            { subscriberId: isWeb ? auditSubscriberId : mailSubscriberId }
        );
    }
}

/**
 * Lets the parent choose which role emits.
 */
@Controller('/cluster-heterogeneous')
class HeterogeneousEventController {
    /**
     * Emits one order event from this instance.
     */
    @Post('/emit')
    async emit(): Promise<void> {
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        await eventService.emit(eventType, {});
    }
}

const options: StartTestServerOptions = {
    controllers: [HeterogeneousEventController],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so the real cron service has to be kept here - without it nothing
    // polls for unfinished events at all
    providers: [
        ...defaultClusterProviders,
        defineProvider({ token: HeterogeneousRoleSubscriber, useClass: HeterogeneousRoleSubscriber })
    ]
};

export default options;