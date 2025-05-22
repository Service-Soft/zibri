import { KnownHeader } from './known-header.type';

export type Header = KnownHeader | (string & {});