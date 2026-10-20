import { ExcludeStrict } from './exclude-strict.type.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export type OmitStrict<T extends object, K extends keyof T> = Pick<
    T,
    ExcludeStrict<keyof T, K>
>;