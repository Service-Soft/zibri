import { KnownHeader } from './known-header.enum';

/**
 * All possible headers, including custom ones.
 */
export type Header = KnownHeader | (string & {});