import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };

/**
 * The members of an export of one kind, such as its methods, which its page shows under a heading of their own.
 */
export type ApiSection = {
    title: string,
    id: string,
    members: JSONOutput.DeclarationReflection[]
};