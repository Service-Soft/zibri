import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { JsonUtilities } from '../../utilities/json.utilities';

/**
 * What a keyset cursor carries, before it is encoded.
 */
type KeysetCursorPayload = {
    /**
     * The order the page it came from was read in, as `property:DIRECTION` pairs.
     *
     * Carried so that a cursor cannot be handed to a differently ordered read. The values in it are
     * the position of one row *in that order*, and they say nothing about a position in any other -
     * a cursor from `createdAt ASC` used against `createdAt DESC` would silently walk away from the
     * rows it was meant to continue through.
     */
    order: string,
    /**
     * The values of the order properties on the row the page ended at, in the order's own order.
     */
    values: (string | number | boolean)[]
};

/**
 * What a cursor is asked to carry.
 */
export type KeysetCursorContent = {
    /**
     * The fingerprint of the read the cursor was issued by.
     */
    order: string,
    /**
     * The value of each order property on the row the previous page ended at.
     */
    values: (string | number | boolean)[]
};

/**
 * Whether the given value is a payload this module wrote.
 *
 * A cursor usually arrives from outside - a query parameter a client sent back - so what comes out
 * of the decoding is unknown until it has been looked at.
 * @param value - The parsed cursor content.
 * @returns Whether it has the shape a cursor carries.
 */
function isKeysetCursorPayload(value: unknown): value is KeysetCursorPayload {
    if (typeof value !== 'object' || value == undefined) {
        return false;
    }
    const candidate: Partial<KeysetCursorPayload> = value as Partial<KeysetCursorPayload>;
    return typeof candidate.order === 'string'
        && Array.isArray(candidate.values)
        && candidate.values.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
}

/**
 * Encodes where a page ended, so that the next one can continue from it.
 *
 * Opaque on purpose. What it holds is an implementation of "after this row", and a caller that
 * reads values out of it would be relying on a shape that is free to change - the same reason the
 * cursor is handed back whole rather than as the values it stands for.
 * @param content - The content to encode the cursor from.
 * @returns The cursor to continue from, safe to put in a url or a json response.
 */
export function encodeKeysetCursor(content: KeysetCursorContent): string {
    const payload: KeysetCursorPayload = { order: content.order, values: content.values };
    return Buffer.from(JsonUtilities.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Reads back what a cursor names.
 *
 * Every failure here is the same kind of thing - a cursor that was truncated by a url, edited by
 * hand, or kept from a read that asked for a different order - and all of them are the caller
 * having asked for a page that cannot be answered, rather than anything being wrong with the store.
 * @param cursor - The cursor handed back by the previous page.
 * @param expectedOrder - The fingerprint of the order this read is being made in.
 * @returns The values the next page starts after.
 * @throws When the cursor cannot be read, or was issued for a different order.
 */
export function decodeKeysetCursor(cursor: string, expectedOrder: string): (string | number | boolean)[] {
    let parsed: unknown;
    try {
        parsed = JsonUtilities.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    }
    catch (error) {
        throw new BadRequestError($ts`The cursor could not be read.`, { cause: error });
    }

    if (!isKeysetCursorPayload(parsed)) {
        throw new BadRequestError($ts`The cursor could not be read.`);
    }
    if (parsed.order !== expectedOrder) {
        // named rather than only refused, because the two orders are what a caller has to compare
        // to see what happened - almost always a cursor kept across a change of order
        throw new BadRequestError(
            $ts`The cursor was made for the order "${parsed.order}" and this read is ordered by "${expectedOrder}".`
        );
    }
    return parsed.values;
}