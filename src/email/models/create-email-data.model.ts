import { Email } from './email.model';
import { CombinedType, OmitType, PartialType, PickType } from '../../entity';

/**
 * Data for creating a new email in the db.
 */
export class CreateEmailData extends OmitType(Email, ['id', 'createdAt']) {}

/**
 * Data for queuing a new email.
 */
export class QueueEmailData extends CombinedType(
    OmitType(CreateEmailData, ['status', 'priority', 'persist', 'sender']),
    PartialType(PickType(CreateEmailData, ['priority', 'persist', 'sender']))
) {}