import { Property } from '../../../entity/decorators/property.decorator';
import { NextcloudOcsShare } from './nextcloud-ocs-share.model';

/**
 * The content of an answer about shares.
 */
class NextcloudOcsShareListAnswerContent {
    /**
     * The shares.
     */
    @Property.array({ items: { type: 'object', cls: () => NextcloudOcsShare, allowAdditionalProperties: true } })
    data!: NextcloudOcsShare[];
}

/**
 * What the share api of Nextcloud answers a read of shares with, such as of one by its id.
 */
export class NextcloudOcsShareListAnswer {
    /**
     * The content, beside what it says of the request.
     */
    @Property.object({ cls: () => NextcloudOcsShareListAnswerContent, allowAdditionalProperties: true })
    ocs!: NextcloudOcsShareListAnswerContent;
}