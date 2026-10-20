import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model.ts';
import { ExcludeStrict } from '../../../types/exclude-strict.type.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';

/**
 * A filter for a boolean where property.
 */
export type BooleanWhereFilter = ExcludeStrict<
    BaseWhereFilter<boolean, BaseWhereFilterObject<boolean>>,
    BaseWhereFilterObject<boolean>
> | Required<OmitStrict<BaseWhereFilterObject<boolean>, 'oneOf' | 'notOneOf'>>;