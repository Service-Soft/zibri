import { type NewPostingRuleSetModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { PostingRules } from './posting-rules.model';

/**
 * A posting rule set to add to a fiscal year, as `POST /posting-rule-sets` of the `BookkeepingController` and
 * `createRuleSet` of the posting rule service take it.
 */
export class NewPostingRuleSet implements NewPostingRuleSetModel {
    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The first day the rules apply on, at midnight UTC, within the fiscal year. Its first day by default.
     */
    @Property.date({ required: false })
    validFrom?: Date | null;

    /**
     * The rules.
     */
    @Property.object({ cls: () => PostingRules })
    rules!: PostingRules;
}
