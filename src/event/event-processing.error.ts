import { Event } from './event.model';
import { InternalError } from '../error-handling/internal-error.model';
import { JsonUtilities } from '../utilities/json.utilities';

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