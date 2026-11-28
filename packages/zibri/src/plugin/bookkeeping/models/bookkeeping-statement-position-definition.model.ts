import { type TranslationToken } from '../../../localization/translate.function';
import { type BookkeepingBalanceSide } from './bookkeeping-balance-side.type';

/**
 * A position of a statement structure, such as `assets.B.IV` of a balance sheet. Its amount is what the accounts
 * mapped to it, the positions below it and the positions it `sums` add up to.
 */
export type BookkeepingStatementPositionDefinition = {
    /**
     * The id of the position, unique in its structure and stable, such as `assets.B.IV`. Accounts name it as their
     * `statementPosition`.
     */
    readonly id: string,
    /**
     * The label of the position, in English, such as `$t\`Trade receivables\``, translated in the locale of a report.
     */
    readonly label: TranslationToken,
    /**
     * The side whose balance counts positive in this position and the ones below it, in place of the one of the
     * position above it.
     */
    readonly positiveBalance?: BookkeepingBalanceSide,
    /**
     * The positions below it, which its amount adds up.
     */
    readonly positions?: readonly BookkeepingStatementPositionDefinition[],
    /**
     * The ids of the positions its amount adds up besides those below it: of the full structure a shortened one rolls
     * up from, or of its own structure for a subtotal, such as the result after taxes.
     */
    readonly sums?: readonly string[]
};
