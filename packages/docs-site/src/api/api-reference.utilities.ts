import { existsSync, readFileSync } from 'node:fs';

import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import * as zibriExports from 'zibri';
import { BaseEntity, JsonUtilities, Newable } from 'zibri';
import { MetadataUtilities } from 'zibri/internal';

import { ApiCodeTarget, ApiExport, ApiKind } from './api-export.model';
import { API_JSON_FILE } from './api-json-file';
import { REFLECTION_KINDS } from './reflection-kinds';
import { BASE_PATH } from '../base-path';

/**
 * The reference, read from typedoc's json once.
 */
type ApiReference = {
    // in the order of typedoc, which decided which of two names differing only in case kept its address
    declarations: JSONOutput.DeclarationReflection[],
    exports: Map<string, ApiExport>,
    // where each reflection a link or a type can name is documented: the page of an export, or a section of it
    addresses: Map<number, string>
};

/**
 * The folder of the API reference below the site, which the sidebar marks as the file of its pages.
 */
export const API_FOLDER: string = 'api';

// the kind of each reflection an export can be; a class is an entity when zibri stores it as rows
const API_KINDS: ReadonlyMap<number, ApiKind> = new Map<number, ApiKind>([
    [REFLECTION_KINDS.Class, 'class'],
    [REFLECTION_KINDS.Interface, 'interface'],
    [REFLECTION_KINDS.TypeAlias, 'type'],
    [REFLECTION_KINDS.Function, 'function'],
    [REFLECTION_KINDS.Variable, 'variable'],
    [REFLECTION_KINDS.Enum, 'enum'],
    [REFLECTION_KINDS.Namespace, 'namespace']
]);

// of a name declaring several things, the kind its badge shows: the first of these it declares
const KIND_ORDER: ApiKind[] = ['entity', 'class', 'interface', 'function', 'enum', 'type', 'variable', 'namespace'];

/**
 * Whether a value is a class extending `BaseEntity`.
 * @param value - The value.
 * @returns Whether it is.
 */
function isBaseEntityClass(value: unknown): value is Newable<BaseEntity> {
    return typeof value === 'function' && value.prototype instanceof BaseEntity;
}

/**
 * The exports of zibri, as typedoc reads them from its sources.
 */
export abstract class ApiReferenceUtilities {
    private static reference: ApiReference | undefined;

    /**
     * Every export, by name.
     * @returns The exports.
     */
    static resolveExports(): ApiExport[] {
        return [...this.resolveReference().exports.values()];
    }

    /**
     * Finds an export by its name.
     * @param name - The name, such as `MarkdownService`.
     * @returns The export, or undefined when zibri exports no such name.
     */
    static findExport(name: string): ApiExport | undefined {
        return this.resolveReference().exports.get(name);
    }

    /**
     * The address of the page of an export.
     * @param name - The name of the export.
     * @returns The address, such as `/zibri/api/MarkdownService/`.
     */
    static resolveAddress(name: string): string {
        return `${BASE_PATH}/${API_FOLDER}/${name}/`;
    }

    /**
     * The anchor of a member on the page of its export: its name in lowercase, as typedoc gave it, so a link to a member
     * of a page of typedoc leads to it here.
     * @param name - The name of the member, such as `resolvePage`.
     * @returns The anchor, without `#`.
     */
    static resolveMemberAnchor(name: string): string {
        return name.toLowerCase();
    }

    /**
     * Every declaration typedoc reads, in its order.
     * @returns The declarations.
     */
    static resolveDeclarations(): JSONOutput.DeclarationReflection[] {
        return this.resolveReference().declarations;
    }

    /**
     * Finds the export a code span of a page names: an export, such as `MarkdownService`, a member of one, such as
     * `ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS`, and either called or used as a decorator, such as `@Auth.skip()`.
     * @param code - The text of the code span.
     * @returns Where it is documented and what it is, or undefined for code naming nothing zibri exports.
     */
    static findCodeTarget(code: string): ApiCodeTarget | undefined {
        const match: RegExpExecArray | null = /^@?([$A-Z_a-z][\w$]*)(?:\.([$A-Z_a-z][\w$]*))?(?:\(.*\))?$/.exec(code);
        const apiExport: ApiExport | undefined = match?.[1] == undefined ? undefined : this.findExport(match[1]);
        if (apiExport == undefined) {
            return undefined;
        }
        const member: string | undefined = match?.[2];
        const anchor: string = member != undefined
            && apiExport.declarations.some(declaration => this.resolveMembers(declaration).some(one => one.name === member))
            ? `#${this.resolveMemberAnchor(member)}`
            : '';
        return { address: this.resolveAddress(apiExport.name) + anchor, kind: apiExport.kind };
    }

    /**
     * Finds where a reflection is documented.
     * @param id - The id typedoc gives it.
     * @returns The address of its page or section, or undefined for one the reference does not document.
     */
    static findAddressOf(id: number): string | undefined {
        return this.resolveReference().addresses.get(id);
    }

    private static resolveReference(): ApiReference {
        if (this.reference != undefined) {
            return this.reference;
        }
        if (!existsSync(API_JSON_FILE)) {
            throw new Error(`There is no ${API_JSON_FILE}. Build zibri with "npm run build:prod -w zibri" first.`);
        }
        const project: JSONOutput.ProjectReflection = JsonUtilities.parse(readFileSync(API_JSON_FILE, 'utf8'));
        const entityNames: Set<string> = this.resolveEntityNames();
        const exports: Map<string, ApiExport> = new Map();
        const addresses: Map<number, string> = new Map();
        const declarations: JSONOutput.DeclarationReflection[] = [...project.children ?? []]
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const declaration of declarations) {
            // the page shows first what the badge shows
            const rank: (one: JSONOutput.DeclarationReflection) => number = one => KIND_ORDER.indexOf(this.resolveKind(one, entityNames));
            const merged: JSONOutput.DeclarationReflection[] = [...exports.get(declaration.name)?.declarations ?? [], declaration]
                .sort((a, b) => rank(a) - rank(b));
            const kinds: ApiKind[] = merged.map(one => this.resolveKind(one, entityNames));
            exports.set(declaration.name, {
                name: declaration.name,
                kind: kinds.reduce((first, kind) => KIND_ORDER.indexOf(kind) < KIND_ORDER.indexOf(first) ? kind : first),
                declarations: merged
            });
            const address: string = this.resolveAddress(declaration.name);
            addresses.set(declaration.id, address);
            for (const member of this.resolveMembers(declaration)) {
                addresses.set(member.id, `${address}#${this.resolveMemberAnchor(member.name)}`);
            }
        }
        this.reference = { declarations: project.children ?? [], exports, addresses };
        return this.reference;
    }

    /**
     * The members of a declaration the page of its export documents: those of a class, an interface, an enum or a
     * namespace, and those of the object a type or a variable is.
     * @param declaration - The declaration.
     * @returns The members.
     */
    static resolveMembers(declaration: JSONOutput.DeclarationReflection): JSONOutput.DeclarationReflection[] {
        if (declaration.children != undefined) {
            return declaration.children;
        }
        return declaration.type?.type === 'reflection' ? declaration.type.declaration.children ?? [] : [];
    }

    // the classes zibri stores as rows, which their metadata names, as typedoc records no decorator
    private static resolveEntityNames(): Set<string> {
        const values: Map<string, unknown> = new Map(Object.entries(zibriExports));
        return new Set([...values]
            .filter(([, value]) => isBaseEntityClass(value) && MetadataUtilities.getEntityMetadata(value) != undefined)
            .map(([name]) => name));
    }

    private static resolveKind(declaration: JSONOutput.DeclarationReflection, entityNames: Set<string>): ApiKind {
        const kind: ApiKind | undefined = API_KINDS.get(declaration.kind);
        if (kind == undefined) {
            throw new Error(`typedoc reads ${declaration.name} as a kind of export the reference shows no page for.`);
        }
        return kind === 'class' && entityNames.has(declaration.name) ? 'entity' : kind;
    }
}