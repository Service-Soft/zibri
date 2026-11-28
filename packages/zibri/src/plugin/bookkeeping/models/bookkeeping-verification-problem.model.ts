import { type BookkeepingVerificationProblemModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Something checking the books of a tenant found: an entry or a line that is not as it was posted, or an entry that
 * does not balance.
 */
export class BookkeepingVerificationProblem implements BookkeepingVerificationProblemModel {
    /**
     * The id of the entry the problem is of, or null for a problem of a line alone.
     */
    @Property.string({ required: false })
    entryId!: string | null;

    /**
     * The id of the line the problem is of, or null for a problem of an entry.
     */
    @Property.string({ required: false })
    lineId!: string | null;

    /**
     * What is wrong.
     */
    @Property.string()
    reason!: string;
}
