import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity';

export type DeleteAllOptions<T extends BaseEntity> = FindAllOptions<T>;