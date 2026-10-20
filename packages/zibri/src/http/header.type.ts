import { KnownHeader } from './known-header.enum.ts';

/**
 * All possible headers, including custom ones.
 */
export type Header = KnownHeader | (string & {});