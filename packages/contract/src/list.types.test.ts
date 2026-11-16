// checked by the typecheck: every `@ts-expect-error` has to stay an error, and every assignment has to compile.
import { FilterConfig } from './filter-config.type';
import { FilterValue } from './filter-value.type';
import { OrderConfig } from './order-config.type';
import { OrderValue } from './order-value.type';

type Address = {
    city: string,
    zip?: string
};

type Team = {
    id: string,
    name: string
};

type Member = {
    email: string,
    joinedAt: Date
};

type Task = {
    id: string,
    title: string,
    priority: number,
    done: boolean,
    dueAt: Date | null,
    address: Address,
    tags: string[],
    team?: Team,
    members: Member[]
};

// eslint-disable-next-line typescript/typedef
const taskFilter = {
    title: 'iLike',
    priority: 'range',
    done: 'equals',
    dueAt: 'range',
    address: { city: 'equals' },
    tags: 'includes',
    team: { name: 'fuzzy' },
    members: { email: 'oneOf' }
} as const satisfies FilterConfig<Task>;

const filter: FilterValue<Task, typeof taskFilter> = {
    title: 'invoice',
    priority: { from: 3 },
    done: false,
    dueAt: { to: new Date('2026-12-31') },
    address: { city: 'Berlin' },
    tags: ['news', 'sport'],
    team: { name: 'Sales' },
    members: { email: ['a@example.com'] }
};

const emptyFilter: FilterValue<Task, typeof taskFilter> = {};

// @ts-expect-error a range doesn't match a string
const rangeOfText: FilterConfig<Task> = { title: 'range' };

// @ts-expect-error a boolean matches only by equality
const textOfBoolean: FilterConfig<Task> = { done: 'iLike' };

// @ts-expect-error an object is filtered by the properties inside it
const matchOfObject: FilterConfig<Task> = { address: 'equals' };

// @ts-expect-error a filter names only properties of the model
const unknownProperty: FilterConfig<Task> = { owner: 'equals' };

// @ts-expect-error a range filter takes bounds of the type of the property
const wrongBound: FilterValue<Task, typeof taskFilter> = { priority: { from: 'high' } };

// @ts-expect-error a filter takes only the properties of its config
const unfilteredProperty: FilterValue<Task, typeof taskFilter> = { id: 'a' };

// eslint-disable-next-line typescript/typedef
const taskOrder = { dueAt: true, address: { city: true }, team: { name: true } } as const satisfies OrderConfig<Task>;

const order: OrderValue<Task, typeof taskOrder> = { team: { name: 'ASC' }, dueAt: 'DESC' };

// @ts-expect-error nothing orders by an array
const orderByArray: OrderConfig<Task> = { tags: true };

// @ts-expect-error nothing orders by an array of objects either
const orderByItems: OrderConfig<Task> = { members: { email: true } };

// @ts-expect-error an order takes a direction
const wrongDirection: OrderValue<Task, typeof taskOrder> = { dueAt: 'UP' };

// @ts-expect-error an order takes only the properties of its config
const unorderedProperty: OrderValue<Task, typeof taskOrder> = { title: 'ASC' };

export const checked: unknown[] = [
    taskFilter,
    taskOrder,
    filter,
    emptyFilter,
    rangeOfText,
    textOfBoolean,
    matchOfObject,
    unknownProperty,
    wrongBound,
    unfilteredProperty,
    order,
    orderByArray,
    orderByItems,
    wrongDirection,
    unorderedProperty
];