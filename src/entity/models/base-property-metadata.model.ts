
export type BasePropertyMetadata = {
    required: boolean,
    description: string | undefined
};

export type WithDefaultMetadata<T extends string | number | boolean | Date> = {
    default: T | (<X extends Object>(createData: X) => T | Promise<T>) | undefined
};