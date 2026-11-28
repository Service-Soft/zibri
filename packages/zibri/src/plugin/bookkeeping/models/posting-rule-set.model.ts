import { type PostingRuleSetModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { PostingRules } from './posting-rules.model';

/**
 * The posting rules of a fiscal year from a day on. A document is posted by the rule set of its fiscal year valid on
 * its day: the one with the latest `validFrom` on or before it. A second rule set of a year changes the rules within
 * it, such as when the VAT exemption of a small business ends. A fiscal year after another starts with a copy of the
 * rules valid at its end.
 */
@Entity({ allowOrphan: true, uniques: [['fiscalYearId', 'validFrom']] })
export class PostingRuleSet extends BaseEntity implements PostingRuleSetModel {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the fiscal year the rules are of.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The first day the rules apply on, at midnight UTC, until the next rule set of the fiscal year.
     */
    @Property.date()
    validFrom!: Date;

    /**
     * The rules.
     */
    @Property.object({ cls: () => PostingRules })
    rules!: PostingRules;
}

/**
 * What a rule set is created with.
 */
export type PostingRuleSetCreateData = Pick<PostingRuleSet, 'fiscalYearId' | 'validFrom' | 'rules'>;
