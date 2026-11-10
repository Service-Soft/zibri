import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };

/**
 * What an export of zibri is, as its page and its badge show it. An entity is a class zibri stores as rows.
 */
export type ApiKind = 'class' | 'entity' | 'interface' | 'type' | 'function' | 'variable' | 'enum' | 'namespace';

/**
 * What code on a page names: an export, or a member of one.
 */
export type ApiCodeTarget = {
    // the page of the export, with the anchor of the member
    address: string,
    kind: ApiKind
};

/**
 * A name zibri exports, with its page in the API reference.
 */
export type ApiExport = {
    name: string,
    kind: ApiKind,
    // what the name declares: one thing, or several merged, such as a function and a namespace of the same name
    declarations: JSONOutput.DeclarationReflection[]
};