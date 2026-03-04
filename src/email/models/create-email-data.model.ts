import { Email } from './email.model';
import { IntersectionClass } from '../../entity/intersection-class.model';
import { OmitClass } from '../../entity/omit-class.model';
import { PartialClass } from '../../entity/partial-class.model';
import { PickClass } from '../../entity/pick-class.model';

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