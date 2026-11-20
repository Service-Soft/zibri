import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';

/**
 * A filter for a boolean where property.
 */
export type BooleanWhereFilter = ExcludeStrict<
    BaseWhereFilter<boolean, BaseWhereFilterObject<boolean>>,
    BaseWhereFilterObject<boolean>
> | Required<OmitStrict<BaseWhereFilterObject<boolean>, 'oneOf' | 'notOneOf'>>;