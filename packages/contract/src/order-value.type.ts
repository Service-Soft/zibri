import { OrderConfig } from './order-config.type';
import { OrderDirection } from './order-direction.type';

/**
 * The order of a list of `T` that may be ordered as `C` says, the `order` of a request: a direction for each property
 * to order by. A property named first orders first, and the ones after it order the rows it finds equal.
 * @example
 * const order: OrderValue<Task, typeof taskOrder> = { team: { name: 'ASC' }, dueAt: 'DESC' };
 */
export type OrderValue<T, C extends OrderConfig<T> = OrderConfig<T>> = {
    -readonly [K in keyof C & keyof T]?: C[K] extends true
        ? OrderDirection
        : C[K] extends OrderConfig<NonNullable<T[K]>>
            ? OrderValue<NonNullable<T[K]>, C[K]>
            : never
};