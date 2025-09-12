import { Email } from './email.model';
import { IntersectionClass, OmitClass, PartialClass, PickClass } from '../../entity';

/**
 * Data for creating a new email in the db.
 */
export class CreateEmailData extends OmitClass(Email, ['id', 'createdAt']) {}

/**
 * Data for queuing a new email.
 */
export class QueueEmailData extends IntersectionClass(
    OmitClass(CreateEmailData, ['status', 'priority', 'persist', 'sender']),
    PartialClass(PickClass(CreateEmailData, ['priority', 'persist', 'sender']))
) {}