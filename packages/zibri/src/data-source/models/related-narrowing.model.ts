import { type Where } from './where/where-filter.model';
import { type BaseEntity } from '../../entity/base-entity.model';
import { type DenyAll } from '../../entity/models/entity-scope.model';
import { type Newable } from '../../types/newable.type';

/**
 * What the rows of each entity a call reaches through a relation are narrowed to: the rows the
 * caller may see of it, as its scope and its soft delete decide.
 *
 * Applied wherever a relation is resolved or judged - the rows it holds, a filter through it and a
 * count of it. An entity that is not in it is not narrowed; `denyAll` means the caller may see none
 * of its rows.
 */
export type RelatedNarrowing = ReadonlyMap<Newable<BaseEntity>, Where<BaseEntity> | DenyAll>;