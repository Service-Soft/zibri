import { Event } from './event.model.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';

/**
 * An error that gets logged when the processing of an event failed.
 */
export class EventProcessingError<T> extends InternalError {
    constructor(event: Event<T>, subscriberId: string, cause: Error) {
        const message: string = [
            `Error processing event "${event.type}" for subscriber "${subscriberId}" with data:`,
            JsonUtilities.stringify(event.data, undefined, 2)
        ].join('\n');
        super(message, { cause });
        this.name = 'EventProcessingError';
    }
}