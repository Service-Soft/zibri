import { ExcludeStrict } from './exclude-strict.type';

// eslint-disable-next-line jsdoc/require-jsdoc
export type OmitStrict<T extends object, K extends keyof T> = Pick<
    T,
    ExcludeStrict<keyof T, K>
>;