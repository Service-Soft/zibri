import { type KeyWhere } from './unique-declaration.model';
import { type TranslationToken } from '../../localization/translate.function';

/**
 * A rule every row of an entity has to follow.
 */
export type EntityCheck = {
    /**
     * The filter every row has to match, written with `whereFor`, such as a done task having a
     * completion date: `whereFor<Task>([{ status: { not: 'done' } }, { completedAt: { not: null } }])`.
     *
     * It compares a property against a string, number, boolean or null - as it is, or with `not`,
     * `oneOf`, `notOneOf`, or a comparison of numbers. A row holding null for a property it compares
     * matches `not` and `notOneOf` unless they name null, and never matches a comparison.
     */
    where: KeyWhere,
    /**
     * What a value breaking the check is answered with as its problem's `code`, for a client to tell
     * the check apart by, such as `'completedAtRequired'`.
     */
    code: string,
    /**
     * What a value breaking the check is answered with as its problem's message, written with `$t`
     * so it is translated for the request.
     */
    message: TranslationToken
};