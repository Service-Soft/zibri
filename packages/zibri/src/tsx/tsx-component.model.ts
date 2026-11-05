import { TsxElement } from 'zibri-tsx';

/**
 * The authoring types a template needs, re-exported so templates only ever import from zibri.
 */
export type { TsxChildren, TsxElement } from 'zibri-tsx';

/**
 * Definition of a valid tsx component that can be rendered by zibri.
 *
 * At runtime the zibri-tsx build step replaces the exported function with a compiled component
 * object; this type exists so the template itself type checks as tsx.
 */
export type TsxComponent<T = {}> = (props: T) => TsxElement;