import { ExcludeStrict } from './exclude-strict.type';

export type OmitStrict<T extends object, K extends keyof T> = Pick<
    T,
    ExcludeStrict<keyof T, K>
>;