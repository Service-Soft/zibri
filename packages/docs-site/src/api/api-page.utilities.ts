import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { MdxHeading } from 'zibri';

import { ApiExport, ApiKind } from './api-export.model';
import { ApiReferenceUtilities } from './api-reference.utilities';
import { ApiSection } from './api-section.model';
import { REFLECTION_KINDS } from './reflection-kinds';

// the sections of a page, in this order, by the kind of their members
const SECTIONS: [number, string][] = [
    [REFLECTION_KINDS.Constructor, 'Constructors'],
    [REFLECTION_KINDS.EnumMember, 'Members'],
    [REFLECTION_KINDS.Property, 'Properties'],
    [REFLECTION_KINDS.Accessor, 'Accessors'],
    [REFLECTION_KINDS.Method, 'Methods'],
    [REFLECTION_KINDS.Function, 'Functions'],
    [REFLECTION_KINDS.Variable, 'Variables'],
    [REFLECTION_KINDS.Class, 'Classes'],
    [REFLECTION_KINDS.Interface, 'Interfaces'],
    [REFLECTION_KINDS.TypeAlias, 'Types'],
    [REFLECTION_KINDS.Enum, 'Enums']
];

/**
 * The title of the exports of a kind, as the index of the reference groups them.
 */
export const API_KIND_TITLES: Record<ApiKind, string> = {
    class: 'Classes',
    entity: 'Entities',
    interface: 'Interfaces',
    type: 'Types',
    function: 'Functions',
    variable: 'Variables',
    enum: 'Enums',
    namespace: 'Namespaces'
};

/**
 * What the page of an export shows.
 */
export abstract class ApiPageUtilities {
    /**
     * The members of an export, by kind, in the order its page shows them.
     * @param apiExport - The export.
     * @returns The sections, none for an export without members.
     */
    static resolveSections(apiExport: ApiExport): ApiSection[] {
        const members: JSONOutput.DeclarationReflection[] = apiExport.declarations
            .flatMap(declaration => ApiReferenceUtilities.resolveMembers(declaration));
        return SECTIONS
            .map(([kind, title]) => ({ title, id: title.toLowerCase(), members: members.filter(member => member.kind === kind) }))
            .filter(section => section.members.length > 0);
    }

    /**
     * The headings of the page of an export, which the side of the page lists.
     * @param sections - The sections of the page.
     * @returns A heading per section, and one per member below it.
     */
    static resolveHeadings(sections: ApiSection[]): MdxHeading[] {
        return sections.flatMap(section => [
            { depth: 2, text: section.title, id: section.id } satisfies MdxHeading,
            ...section.members.map(member => ({
                depth: 3,
                text: member.name,
                id: ApiReferenceUtilities.resolveMemberAnchor(member.name)
            } satisfies MdxHeading))
        ]);
    }

    /**
     * The comment of a member or an export: that of its first signature for a function, a method or an accessor.
     * @param declaration - The member or export.
     * @returns The comment, or undefined when it has none.
     */
    static findComment(declaration: JSONOutput.DeclarationReflection): JSONOutput.Comment | undefined {
        return declaration.comment
            ?? declaration.signatures?.[0]?.comment
            ?? declaration.getSignature?.comment
            ?? declaration.setSignature?.comment;
    }
}