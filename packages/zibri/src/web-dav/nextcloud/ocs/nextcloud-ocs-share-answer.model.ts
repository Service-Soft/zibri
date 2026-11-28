import { Property } from '../../../entity/decorators/property.decorator';
import { NextcloudOcsShare } from './nextcloud-ocs-share.model';

/**
 * The content of an answer about one share.
 */
class NextcloudOcsShareAnswerContent {
    /**
     * The share.
     */
    @Property.object({ cls: () => NextcloudOcsShare, allowAdditionalProperties: true })
    data!: NextcloudOcsShare;
}

/**
 * What the share api of Nextcloud answers the creation of a share with.
 */
export class NextcloudOcsShareAnswer {
    /**
     * The content, beside what it says of the request.
     */
    @Property.object({ cls: () => NextcloudOcsShareAnswerContent, allowAdditionalProperties: true })
    ocs!: NextcloudOcsShareAnswerContent;
}