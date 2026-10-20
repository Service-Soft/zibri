import { Email } from './email.model.ts';
import { IntersectionClass } from '../../entity/intersection-class.model.ts';
import { OmitClass } from '../../entity/omit-class.model.ts';
import { PartialClass } from '../../entity/partial-class.model.ts';
import { PickClass } from '../../entity/pick-class.model.ts';

/**
 * Data for creating a new email in the db.
 */
export class CreateEmailData extends OmitClass(Email, ['id', 'createdAt', 'attempts']) {}

/**
 * Data for queuing a new email.
 */
export class QueueEmailData extends IntersectionClass(
    OmitClass(CreateEmailData, ['status', 'priority', 'persist', 'sender', 'retryAt']),
    PartialClass(PickClass(CreateEmailData, ['priority', 'persist', 'sender']))
) {}