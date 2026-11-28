import { type TranslationToken } from '../../../localization/translate.function';
import { type BookkeepingBalanceSide } from './bookkeeping-balance-side.type';
import { type BookkeepingStatementPositionDefinition } from './bookkeeping-statement-position-definition.model';
import { type BookkeepingStatementType } from './bookkeeping-statement-type.enum';

/**
 * The form of a statement as data: its positions, their order and their sums, such as the balance sheet of § 266 HGB.
 * A full structure has the positions accounts are mapped to. A shortened one rolls up from a full one: each of its
 * positions names the positions of the full structure it adds up, so one mapping of the accounts serves every form.
 */
export type BookkeepingStatementStructure = {
    /**
     * The id of the structure, such as `hgb.balance-sheet`, which a report names as its form.
     */
    readonly id: string,
    /**
     * What the statement states.
     */
    readonly type: BookkeepingStatementType,
    /**
     * The label of the structure, in English, such as `$t\`Balance sheet\``, translated in the locale of a report.
     */
    readonly label: TranslationToken,
    /**
     * The name of the structure, in English, telling it from the other forms of its statement where one is chosen,
     * such as `$t\`Shortened balance sheet of a small corporation (§ 266 (1) sentence 3 HGB)\``. The label by default.
     */
    readonly name?: TranslationToken,
    /**
     * The side whose balance counts positive in its positions, unless a position names another.
     */
    readonly positiveBalance: BookkeepingBalanceSide,
    /**
     * The id of the full structure a shortened one adds up the positions of, or undefined for a full structure.
     */
    readonly rollsUpFrom?: string,
    /**
     * The id of the position of a full balance sheet the result of the fiscal year is part of, revenue less expenses,
     * whether or not it is posted, such as `equity-and-liabilities.A.V`.
     */
    readonly resultPosition?: string,
    /**
     * The positions at the top, in their order.
     */
    readonly positions: readonly BookkeepingStatementPositionDefinition[]
};
