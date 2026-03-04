import { JSX } from 'preact';

/**
 * Definition of a valid preact component that can be rendered by zibri.
 */
export type PreactComponent<T = {}> = (props: T) => JSX.Element;