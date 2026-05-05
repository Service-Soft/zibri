// eslint-disable-next-line jsdoc/require-jsdoc
export type AnyEnum<T extends string | number | bigint = string | number | bigint> = { [key: string]: T };