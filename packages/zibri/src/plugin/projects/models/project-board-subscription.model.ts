import { type ProjectBoardSubscriptionModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The board to receive the changes of, as the `subscribe` and `unsubscribe` events of the
 * `ProjectBoardWebsocketController` take it, and answer it.
 */
export class ProjectBoardSubscription implements ProjectBoardSubscriptionModel {
    /**
     * The id of the project.
     */
    @Property.string({ format: 'uuid' })
    projectId!: string;
}