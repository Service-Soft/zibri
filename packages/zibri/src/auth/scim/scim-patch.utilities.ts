import { ScimErrorType } from './scim-error-type.enum';
import { ScimAttributePath, ScimFilter } from './scim-filter.model';
import { ScimFilterUtilities } from './scim-filter.utilities';
import { ScimPatchOperation } from './scim-patch-operation.model';
import { ScimSchema } from './scim-schema.enum';
import { ScimError } from './scim.error';
import { HttpStatus } from '../../http/http-status.enum';
import { $ts } from '../../localization/translate.function';
import { JsonUtilities } from '../../utilities/json.utilities';

/**
 * Where in a resource a patch operation applies.
 */
type PatchTarget = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    path: ScimAttributePath,
    /**
     * Which items of a multi-valued attribute it applies to, if it names them.
     */
    filter: ScimFilter | undefined
};

/**
 * What an operation does, once its case is set aside.
 */
type PatchOp = 'add' | 'remove' | 'replace';

const OPERATIONS: ScimPatchOperation['op'][] = ['add', 'remove', 'replace', 'Add', 'Remove', 'Replace', 'ADD', 'REMOVE', 'REPLACE'];

/**
 * Applies SCIM patch requests (RFC 7644, 3.5.2) to resources.
 */
export abstract class ScimPatchUtilities {
    /**
     * Reads the operations of a patch request.
     * @param body - The request body.
     * @returns Its operations.
     * @throws A ScimError (invalidSyntax) when the body is not a patch request.
     */
    static resolveOperations(body: unknown): ScimPatchOperation[] {
        const schemas: unknown = ScimFilterUtilities.isRecord(body) ? body['schemas'] : undefined;
        const operations: unknown = ScimFilterUtilities.isRecord(body) ? body['Operations'] : undefined;
        if (!Array.isArray(schemas) || !schemas.includes(ScimSchema.PATCH_OP) || !Array.isArray(operations)) {
            throw new ScimError(
                HttpStatus.BAD_REQUEST,
                $ts`A patch request names the PatchOp schema and holds Operations.`,
                ScimErrorType.INVALID_SYNTAX
            );
        }
        return operations.map(operation => {
            const op: unknown = ScimFilterUtilities.isRecord(operation) ? operation['op'] : undefined;
            const path: unknown = ScimFilterUtilities.isRecord(operation) ? operation['path'] : undefined;
            const known: ScimPatchOperation['op'] | undefined = OPERATIONS.find(o => o === op);
            if (known == undefined || (path != undefined && typeof path !== 'string') || !ScimFilterUtilities.isRecord(operation)) {
                throw new ScimError(
                    HttpStatus.BAD_REQUEST,
                    $ts`An operation is add, remove or replace, with an optional path.`,
                    ScimErrorType.INVALID_SYNTAX
                );
            }
            return { op: known, path: typeof path === 'string' && path !== '' ? path : undefined, value: operation['value'] };
        });
    }

    /**
     * Applies patch operations to a resource.
     * @param resource - The resource, which is left as it is.
     * @param operations - The operations, in the order they are applied.
     * @returns The resource the operations make of it.
     * @throws A ScimError when an operation names a path that is none, a target that does not exist, or
     * an attribute that cannot change.
     */
    static apply(resource: Record<string, unknown>, operations: ScimPatchOperation[]): Record<string, unknown> {
        const patched: Record<string, unknown> = structuredClone(resource);
        for (const operation of operations) {
            const op: PatchOp = this.resolveOp(operation);
            if (operation.path != undefined) {
                this.applyAt(patched, this.parsePath(operation.path), op, operation.value);
                continue;
            }
            if (op === 'remove') {
                throw new ScimError(HttpStatus.BAD_REQUEST, $ts`A remove operation names a path.`, ScimErrorType.NO_TARGET);
            }
            if (!ScimFilterUtilities.isRecord(operation.value)) {
                throw new ScimError(
                    HttpStatus.BAD_REQUEST,
                    $ts`An operation without a path holds the attributes it changes.`,
                    ScimErrorType.INVALID_VALUE
                );
            }
            for (const [key, value] of Object.entries(operation.value)) {
                this.applyWithoutPath(patched, key, op, value);
            }
        }
        return patched;
    }

    private static resolveOp(operation: ScimPatchOperation): PatchOp {
        switch (operation.op) {
            case 'add':
            case 'Add':
            case 'ADD': {
                return 'add';
            }
            case 'remove':
            case 'Remove':
            case 'REMOVE': {
                return 'remove';
            }
            case 'replace':
            case 'Replace':
            case 'REPLACE': {
                return 'replace';
            }
        }
    }

    /**
     * Applies one attribute of an operation that names no path.
     * @param resource - The resource being patched.
     * @param key - The attribute, or the schema of an extension holding the attributes in `value`.
     * @param op - The operation.
     * @param value - The value.
     */
    private static applyWithoutPath(resource: Record<string, unknown>, key: string, op: 'add' | 'replace', value: unknown): void {
        // the schema of an extension, whose attributes the value holds, eg.
        // "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { "employeeNumber": "42" }
        if (/^urn:.*:(user|group)$/i.test(key) && ScimFilterUtilities.isRecord(value)) {
            for (const [attribute, attributeValue] of Object.entries(value)) {
                this.applyAt(resource, { path: { uri: key, attribute, subAttribute: undefined }, filter: undefined }, op, attributeValue);
            }
            return;
        }
        this.applyAt(resource, this.parsePath(key), op, value);
    }

    /**
     * Reads the path of an operation.
     * @param text - The path, eg. `name.givenName` or `emails[type eq "work"].value`.
     * @returns Where the operation applies.
     * @throws A ScimError (invalidPath) when it is not a path.
     */
    private static parsePath(text: string): PatchTarget {
        const open: number = text.indexOf('[');
        if (open === -1) {
            return { path: ScimFilterUtilities.parseAttributePath(text, ScimErrorType.INVALID_PATH), filter: undefined };
        }
        const close: number = text.lastIndexOf(']');
        const after: string = text.slice(close + 1);
        const attribute: ScimAttributePath = ScimFilterUtilities.parseAttributePath(text.slice(0, open), ScimErrorType.INVALID_PATH);
        if (close < open || attribute.subAttribute != undefined || (after !== '' && !/^\.[A-Za-z][\w$-]*$/.test(after))) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`"${text}" is not a path.`, ScimErrorType.INVALID_PATH);
        }
        return {
            path: { ...attribute, subAttribute: after === '' ? undefined : after.slice(1) },
            filter: ScimFilterUtilities.parse(text.slice(open + 1, close))
        };
    }

    /**
     * Applies an operation where its path points.
     * @param resource - The resource being patched.
     * @param target - Where the operation applies.
     * @param op - The operation.
     * @param value - The value.
     * @throws A ScimError (mutability) for the id, and (noTarget) for a filter that matches no item.
     */
    private static applyAt(resource: Record<string, unknown>, target: PatchTarget, op: PatchOp, value: unknown): void {
        if (target.path.uri == undefined && target.path.attribute.toLowerCase() === 'id') {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`The id of a resource cannot change.`, ScimErrorType.MUTABILITY);
        }
        const container: Record<string, unknown> | undefined = this.findContainer(resource, target.path, op !== 'remove');
        if (container == undefined) {
            return;
        }
        const key: string = ScimFilterUtilities.findKey(container, target.path.attribute) ?? target.path.attribute;
        const subAttribute: string | undefined = target.path.subAttribute;
        if (target.filter != undefined) {
            this.applyToItems(container, key, target, op, value);
            return;
        }
        if (subAttribute == undefined) {
            this.applyToValue(container, key, op, value);
            return;
        }
        const existing: unknown = container[key];
        if (Array.isArray(existing)) {
            // a sub-attribute of every item, which is what a path without a filter names
            for (const item of existing.filter(i => ScimFilterUtilities.isRecord(i))) {
                this.applyToSubAttribute(item, subAttribute, op, value);
            }
            return;
        }
        if (!ScimFilterUtilities.isRecord(existing) && op === 'remove') {
            return;
        }
        const complex: Record<string, unknown> = ScimFilterUtilities.isRecord(existing) ? existing : {};
        container[key] = complex;
        this.applyToSubAttribute(complex, subAttribute, op, value);
    }

    /**
     * Applies an operation to a sub-attribute of a complex value.
     * @param complex - The complex value.
     * @param subAttribute - The name of the sub-attribute.
     * @param op - The operation.
     * @param value - The value.
     */
    private static applyToSubAttribute(complex: Record<string, unknown>, subAttribute: string, op: PatchOp, value: unknown): void {
        this.applyToValue(complex, ScimFilterUtilities.findKey(complex, subAttribute) ?? subAttribute, op, value);
    }

    /**
     * Applies an operation to the items of a multi-valued attribute a filter selects.
     * @param container - The object holding the attribute.
     * @param key - The attribute.
     * @param target - The filter, and the sub-attribute of each item, if one is named.
     * @param op - The operation.
     * @param value - The value.
     * @throws A ScimError (noTarget) when the filter matches no item and describes none to add.
     */
    private static applyToItems(
        container: Record<string, unknown>,
        key: string,
        target: PatchTarget,
        op: PatchOp,
        value: unknown
    ): void {
        const filter: ScimFilter | undefined = target.filter;
        const subAttribute: string | undefined = target.path.subAttribute;
        const existing: unknown = container[key];
        const items: unknown[] = Array.isArray(existing) ? existing : [];
        const matching: Record<string, unknown>[] = items
            .filter(i => ScimFilterUtilities.isRecord(i))
            .filter(i => filter != undefined && ScimFilterUtilities.matches(filter, i));
        if (op === 'remove' && subAttribute == undefined) {
            container[key] = items.filter(i => !ScimFilterUtilities.isRecord(i) || !matching.includes(i));
            return;
        }
        if (op !== 'remove' && !matching.length) {
            // an item the filter names by its values, which identity providers add this way, eg.
            // `emails[type eq "work"].value`: made of what the filter says it holds
            const item: Record<string, unknown> | undefined = filter == undefined ? undefined : this.resolveItemOf(filter);
            if (item == undefined) {
                throw new ScimError(HttpStatus.BAD_REQUEST, $ts`No item matches the filter of the path.`, ScimErrorType.NO_TARGET);
            }
            container[key] = [...items, item];
            matching.push(item);
        }
        for (const item of matching) {
            if (subAttribute != undefined) {
                this.applyToSubAttribute(item, subAttribute, op, value);
            }
            else if (ScimFilterUtilities.isRecord(value)) {
                Object.assign(item, value);
            }
        }
    }

    /**
     * Applies an operation to one attribute.
     * @param container - The object holding it.
     * @param key - The attribute.
     * @param op - The operation.
     * @param value - The value.
     */
    private static applyToValue(container: Record<string, unknown>, key: string, op: PatchOp, value: unknown): void {
        const existing: unknown = container[key];
        if (op === 'remove') {
            // the items to remove, which Entra ID names this way, eg. a member by its value
            if (Array.isArray(existing) && Array.isArray(value)) {
                container[key] = existing.filter(item => !value.some(removed => this.isSameItem(item, removed)));
                return;
            }
            // eslint-disable-next-line typescript/no-dynamic-delete
            delete container[key];
            return;
        }
        if (Array.isArray(existing) && op === 'add') {
            const present: unknown[] = existing;
            const added: unknown[] = Array.isArray(value) ? value : [value];
            container[key] = [...present, ...added.filter(item => !present.some(p => this.isSameItem(p, item)))];
            return;
        }
        // a complex attribute keeps the sub-attributes the value does not name, for add and replace alike
        if (ScimFilterUtilities.isRecord(existing) && ScimFilterUtilities.isRecord(value)) {
            Object.assign(existing, value);
            return;
        }
        container[key] = value;
    }

    /**
     * Finds the object an attribute is held in: the resource, or the object of the extension its path
     * names.
     * @param resource - The resource.
     * @param path - The path.
     * @param create - Whether to add the extension's object when the resource has none.
     * @returns The object, or undefined when there is none and none is created.
     */
    private static findContainer(
        resource: Record<string, unknown>,
        path: ScimAttributePath,
        create: boolean
    ): Record<string, unknown> | undefined {
        if (path.uri == undefined) {
            return resource;
        }
        const key: string = ScimFilterUtilities.findKey(resource, path.uri) ?? path.uri;
        const extension: unknown = resource[key];
        if (ScimFilterUtilities.isRecord(extension)) {
            return extension;
        }
        if (!create) {
            return undefined;
        }
        const created: Record<string, unknown> = {};
        resource[key] = created;
        return created;
    }

    /**
     * The item a filter of `eq` comparisons, joined by `and`, describes.
     * @param filter - The filter.
     * @returns The item, or undefined when the filter says something else.
     */
    private static resolveItemOf(filter: ScimFilter): Record<string, unknown> | undefined {
        if (filter.type === 'and') {
            const left: Record<string, unknown> | undefined = this.resolveItemOf(filter.left);
            const right: Record<string, unknown> | undefined = this.resolveItemOf(filter.right);
            return left == undefined || right == undefined ? undefined : { ...left, ...right };
        }
        if (
            filter.type === 'comparison'
            && filter.operator === 'eq'
            && filter.path.uri == undefined
            && filter.path.subAttribute == undefined
        ) {
            return { [filter.path.attribute]: filter.value };
        }
        return undefined;
    }

    /**
     * Whether two items of a multi-valued attribute are the same: by their `value` when both have one,
     * like the members of a group, and by everything they hold otherwise.
     * @param left - One item.
     * @param right - The other.
     * @returns True when they are the same.
     */
    private static isSameItem(left: unknown, right: unknown): boolean {
        const leftValue: unknown = ScimFilterUtilities.isRecord(left) ? left['value'] : undefined;
        const rightValue: unknown = ScimFilterUtilities.isRecord(right) ? right['value'] : undefined;
        if (leftValue != undefined && rightValue != undefined) {
            return leftValue === rightValue;
        }
        return JsonUtilities.stringify(left) === JsonUtilities.stringify(right);
    }
}