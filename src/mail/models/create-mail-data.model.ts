import { Mail } from './mail.model';
import { IntersectionType, OmitType, PartialType, PickType } from '../../entity';

export class CreateMailData extends OmitType(Mail, ['id']) {}

export class QueueMailData extends IntersectionType(
    OmitType(CreateMailData, ['status', 'priority', 'persist']),
    PartialType(PickType(CreateMailData, ['priority', 'persist']))
) {}