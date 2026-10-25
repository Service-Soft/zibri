import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A bound of a date property, asked each time a value is validated: given the object the property
 * is on and the current request, it returns the date, or nothing for no bound.
 */
export type DateBound = (
    // eslint-disable-next-line typescript/no-explicit-any
    data: any,
    ctx: HttpRequestContext | WebsocketRequestContext | undefined
) => Date | undefined;

/**
 * Metadata for date properties.
 */
export type DatePropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<Date> & {
    /**
     * The type of the property.
     */
    type: 'date',
    /**
     * The date the value has to be after, such as `() => new Date()` for a date in the future.
     */
    after: DateBound | undefined,
    /**
     * The date the value has to be before, such as `(booking: Booking) => booking.endsAt`.
     */
    before: DateBound | undefined,
    /**
     * Whether or not the property should be indexed.
     */
    index: boolean,
    /**
     * Whether writing this property requires saying what it was.
     *
     * Last write wins everywhere by default, which is right for most properties and silent data loss
     * for the ones two people edit at once. Declaring this refuses an update that names the property
     * unless the filter names it too, so the write becomes a compare and set: it lands only if the
     * value is still the one the caller acted on.
     */
    optimisticLocking: boolean
};

/**
 * Input Metadata for date properties.
 */
export type DatePropertyMetadataInput = Partial<OmitStrict<DatePropertyMetadata, 'type'>>;