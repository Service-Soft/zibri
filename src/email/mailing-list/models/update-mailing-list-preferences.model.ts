import { Property } from '../../../entity';

/**
 * The data required for updating mailing list preferences.
 */
export class UpdateMailingListPreferences {
    /**
     * The ids of the mailing lists that should be subscribed to.
     */
    @Property.array({ items: { type: 'string' } })
    mailingListIds!: string[];
}