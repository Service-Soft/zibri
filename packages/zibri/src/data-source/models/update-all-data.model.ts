import { DataSourceTimeFor } from './data-source-time.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';

/**
 * An amount added to what a number property stores, in the same write.
 */
export type Increment = {
    /**
     * The amount to add, negative to subtract. A property that holds no value counts as 0.
     */
    increment: number
};

/**
 * What a property of `updateAll` takes besides a value: an amount to add, for a number property.
 */
export type IncrementFor<TValue> = NonNullable<TValue> extends number ? Increment : never;

/**
 * The change `updateAll` applies to every matching row: a value per property, for a number property
 * an amount added to what each row stores, and for a date property the time of the data source.
 */
export type UpdateAllData<T extends BaseEntity, UpdateData extends DeepPartial<T> = DeepPartial<T>> = {
    [K in keyof UpdateData]?: UpdateData[K] | IncrementFor<UpdateData[K]> | DataSourceTimeFor<UpdateData[K]>
};

/**
 * The amounts an update adds, by property.
 */
export type IncrementAmounts = Record<string, number>;