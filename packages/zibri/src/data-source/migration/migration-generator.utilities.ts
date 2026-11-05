import { EntitySnapshot, SnapshotColumn, SnapshotEntity, SnapshotProperty, SnapshotRelation } from './entity-snapshot.model';
import { EntitySnapshotUtilities } from './entity-snapshot.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { ValueConversionUtilities } from '../value-conversion.utilities';

/**
 * What generating the migration of one data source is given.
 */
export type MigrationGenerationInput = {
    /**
     * The snapshot committed with the migrations so far, none for a data source that has none yet.
     */
    previous: EntitySnapshot | undefined,
    /**
     * The snapshot of the entities as they are declared now.
     */
    current: EntitySnapshot,
    /**
     * The name the migration is given. Derived from what it changes when there is none.
     */
    name: string | undefined,
    /**
     * The names of the migrations the data source has, which the new one's is none of.
     */
    takenNames: string[],
    /**
     * Where the migration imports the data source's class from.
     */
    dataSourceImport: string,
    /**
     * The version of the application, which the migration belongs to.
     */
    version: SemVerVersion,
    /**
     * Whether a migration is written although nothing changed, for a migration of your own.
     */
    empty: boolean
};

/**
 * A migration written for one data source.
 */
export type GeneratedMigration = {
    /**
     * The name of its class.
     */
    className: string,
    /**
     * The name of its file.
     */
    fileName: string,
    /**
     * Its code.
     */
    code: string
};

/**
 * One change of a migration, both ways.
 */
type MigrationStep = {
    /**
     * What it changes, as the name of a migration doing only that.
     */
    name: string,
    /**
     * What it changes, as a sentence.
     */
    description: string,
    /**
     * The class of the entity it changes.
     */
    entity: string,
    /**
     * The statements and comments of `up`.
     */
    up: string[],
    /**
     * The statements and comments of `down`.
     */
    down: string[]
};

/**
 * A many to many relation, by the side keeping its join table.
 */
type JoinTableOf = {
    /**
     * The table of the side keeping the join table.
     */
    owner: string,
    /**
     * The class of that side.
     */
    className: string,
    /**
     * The relation's property on that side.
     */
    name: string,
    /**
     * The table of the other side.
     */
    target: string,
    /**
     * The relation's property on the other side.
     */
    inverseSide: string
};

/**
 * A value written into the code of a migration.
 */
type Literal = string | number | boolean | Code | LiteralObject;

/**
 * An object written into the code of a migration. A member that is undefined is left out.
 */
type LiteralObject = {
    [key: string]: Literal | undefined
};

/**
 * Code written as it is, rather than as a value.
 */
class Code {
    constructor(readonly code: string) {}
}

/**
 * How long a line of a generated migration may be before an object is written over several.
 */
const MAX_LINE_LENGTH: number = 140;

/**
 * Where the statements of a method of a generated migration start.
 */
const STATEMENT_INDENT: number = 8;

/**
 * The transaction every helper of a generated migration is handed.
 */
const TRANSACTION: Code = new Code('transaction');

/**
 * Writes the migration that brings what a data source stores from one snapshot to the next.
 *
 * Every entity is named by its table and every property is written out, so the migration means the
 * same in every later version. What a migration cannot know - what a value a cast does not carry
 * becomes, how to fill in a property that becomes required - it says in a comment, and leaves the
 * code it needs failing until the developer writes it.
 */
export abstract class MigrationGeneratorUtilities {
    /**
     * Writes the migration of one data source.
     * @param input - The snapshots, and what the migration is called and belongs to.
     * @returns The migration, or undefined when nothing changed and no empty one is asked for.
     */
    static generate(input: MigrationGenerationInput): GeneratedMigration | undefined {
        const steps: MigrationStep[] = this.resolveSteps(input.previous, input.current);
        if (!steps.length && !input.empty) {
            return undefined;
        }
        const className: string = this.resolveClassName(input.name, steps, input.takenNames);
        return {
            className,
            fileName: `${this.toKebabCase(className.replace(/Migration$/, ''))}.migration.ts`,
            code: this.writeCode(className, steps, input)
        };
    }

    // ── what changed ────────────────────────────────────────────

    /**
     * Resolves the changes from one snapshot to the next, in the order `up` makes them.
     * @param previous - The snapshot before, none when there is none yet.
     * @param current - The snapshot now.
     * @returns The changes: renames, removed relations, created entities, changed properties, added
     * relations, removed entities. `down` makes the reverse of each, the other way round.
     */
    private static resolveSteps(previous: EntitySnapshot | undefined, current: EntitySnapshot): MigrationStep[] {
        const before: Record<string, SnapshotEntity> = previous?.entities ?? {};
        const after: Record<string, SnapshotEntity> = current.entities;
        // by the class, which keeps its name when only its table changes
        const renames: Map<string, string> = new Map();
        for (const [tableName, entity] of ObjectUtilities.entries(after)) {
            const from: string | undefined = before[tableName] == undefined
                ? Object.keys(before).find(t => after[t] == undefined && before[t]?.className === entity.className)
                : undefined;
            if (from != undefined) {
                renames.set(from, tableName);
            }
        }
        const renamedTo: Set<string> = new Set(renames.values());
        const created: string[] = Object.keys(after).filter(t => before[t] == undefined && !renamedTo.has(t));
        const removed: string[] = Object.keys(before).filter(t => after[t] == undefined && !renames.has(t));
        const kept: [string, SnapshotEntity, SnapshotEntity][] = [];
        for (const [tableName, entity] of ObjectUtilities.entries(after)) {
            const was: SnapshotEntity | undefined = before[tableName] ?? before[[...renames].find(([, to]) => to === tableName)?.[0] ?? ''];
            if (was != undefined) {
                kept.push([tableName, was, entity]);
            }
        }
        const afterRenames: (tableName: string) => string = tableName => renames.get(tableName) ?? tableName;
        const joinsBefore: Map<string, JoinTableOf> = this.resolveJoinTables(before, afterRenames);
        const joinsAfter: Map<string, JoinTableOf> = this.resolveJoinTables(after, t => t);
        return [
            ...[...renames].map(([from, to]) => this.renameStep(from, to, after[to]?.className ?? to)),
            ...[...joinsBefore]
                .filter(([key, join]) => !joinsAfter.has(key) && !(removed.includes(join.owner) && removed.includes(join.target)))
                .map(([, join]) => this.removeRelationStep(join)),
            ...created.map(tableName => this.createStep(tableName, after[tableName])),
            ...kept.flatMap(([tableName, was, entity]) => [
                ...this.resolvePropertySteps(tableName, was, entity),
                ...this.toCanonicalJson(was.keys ?? {}) === this.toCanonicalJson(entity.keys ?? {})
                    ? []
                    : [this.changeKeysStep(tableName, entity.className)]
            ]),
            ...[...joinsAfter]
                .filter(([key, join]) => !joinsBefore.has(key) && !created.includes(join.owner) && !created.includes(join.target))
                .map(([, join]) => this.addRelationStep(join)),
            ...removed.map(tableName => this.removeStep(tableName, before[tableName]))
        ];
    }

    /**
     * Resolves the changes of the properties of an entity that is stored before and after.
     * @param tableName - The table it is stored in afterwards.
     * @param was - The entity before.
     * @param entity - The entity after.
     * @returns The changes, one per property added, removed or changed.
     */
    private static resolvePropertySteps(tableName: string, was: SnapshotEntity, entity: SnapshotEntity): MigrationStep[] {
        const before: Map<string, SnapshotColumn> = this.columnsOf(was);
        const after: Map<string, SnapshotColumn> = this.columnsOf(entity);
        const res: MigrationStep[] = [];
        for (const [name, column] of after) {
            const previous: SnapshotColumn | undefined = before.get(name);
            if (previous == undefined) {
                res.push(this.addPropertyStep(tableName, entity.className, name, column));
            }
            else if (this.toCanonicalJson(previous) !== this.toCanonicalJson(column)) {
                res.push(this.changePropertyStep(tableName, entity.className, name, previous, column));
            }
        }
        for (const [name, column] of before) {
            if (!after.has(name)) {
                res.push(this.removePropertyStep(tableName, entity.className, name, column));
            }
        }
        return res;
    }

    // ── the changes ─────────────────────────────────────────────

    private static renameStep(from: string, to: string, className: string): MigrationStep {
        return {
            name: `Rename${this.toPascalCase(from)}To${this.toPascalCase(to)}`,
            description: `Moves "${className}" from the table "${from}" to "${to}".`,
            entity: className,
            up: [this.call('renameEntity', { entity: this.tableOf(to), currentTableName: from, transaction: TRANSACTION })],
            down: [this.call('renameEntity', { entity: this.tableOf(from), currentTableName: to, transaction: TRANSACTION })]
        };
    }

    private static createStep(tableName: string, entity: SnapshotEntity | undefined): MigrationStep {
        if (entity == undefined) {
            throw new InternalError(`The snapshot holds no entity stored in "${tableName}".`);
        }
        return {
            name: `Create${entity.className}`,
            description: `Creates "${entity.className}", stored in "${tableName}".`,
            entity: entity.className,
            up: [
                this.call(
                    'createEntity',
                    { entity: this.tableOf(tableName), properties: this.toPropertiesLiteral(entity), transaction: TRANSACTION }
                )
            ],
            down: [this.call('removeEntity', { entity: this.tableOf(tableName), transaction: TRANSACTION })]
        };
    }

    private static removeStep(tableName: string, entity: SnapshotEntity | undefined): MigrationStep {
        if (entity == undefined) {
            throw new InternalError(`The snapshot holds no entity stored in "${tableName}".`);
        }
        return {
            name: `Remove${entity.className}`,
            description: `Removes "${entity.className}", stored in "${tableName}", with everything it stores.`,
            entity: entity.className,
            up: [this.call('removeEntity', { entity: this.tableOf(tableName), transaction: TRANSACTION })],
            down: [
                `// "${tableName}" comes back empty: the rows it stored are gone`,
                this.call(
                    'createEntity',
                    { entity: this.tableOf(tableName), properties: this.toPropertiesLiteral(entity), transaction: TRANSACTION }
                )
            ]
        };
    }

    private static addPropertyStep(tableName: string, className: string, name: string, column: SnapshotColumn): MigrationStep {
        const optional: SnapshotColumn = { ...column, required: false };
        const up: string[] = [
            this.call(
                'addPropertyToEntity',
                { entity: this.tableOf(tableName), property: this.toPropertyLiteral(optional, name), transaction: TRANSACTION }
            )
        ];
        // added empty, since the rows stored already hold nothing for it, and required once they do
        if (column.required !== false) {
            up.push(
                `// what "${tableName}" stores already holds no "${name}": fill it in here, before it is required`,
                this.call('changePropertyOfEntity', {
                    entity: this.tableOf(tableName),
                    currentProperty: this.toPropertyLiteral(optional, name),
                    property: this.toPropertyLiteral(column, name),
                    transaction: TRANSACTION
                })
            );
        }
        return {
            name: `Add${this.toPascalCase(name)}To${className}`,
            description: `Adds "${name}" to "${className}".`,
            entity: className,
            up,
            down: [this.call('removePropertyFromEntity', { entity: this.tableOf(tableName), propertyKey: name, transaction: TRANSACTION })]
        };
    }

    private static removePropertyStep(tableName: string, className: string, name: string, column: SnapshotColumn): MigrationStep {
        return {
            name: `Remove${this.toPascalCase(name)}From${className}`,
            description: `Removes "${name}" from "${className}", with what it holds.`,
            entity: className,
            up: [this.call('removePropertyFromEntity', { entity: this.tableOf(tableName), propertyKey: name, transaction: TRANSACTION })],
            down: [
                `// "${name}" comes back empty: what it held is gone`,
                this.call('addPropertyToEntity', {
                    entity: this.tableOf(tableName),
                    property: this.toPropertyLiteral({ ...column, required: false }, name),
                    transaction: TRANSACTION
                })
            ]
        };
    }

    private static changePropertyStep(
        tableName: string,
        className: string,
        name: string,
        previous: SnapshotColumn,
        column: SnapshotColumn
    ): MigrationStep {
        return {
            name: `Change${this.toPascalCase(name)}Of${className}`,
            description: `Changes how "${name}" of "${className}" is stored.`,
            entity: className,
            up: this.changeStatements(tableName, name, previous, column),
            down: this.changeStatements(tableName, name, column, previous)
        };
    }

    /**
     * The statements changing a property from one way of storing it to another.
     * @param tableName - The table of the entity.
     * @param name - The property.
     * @param from - How it is stored now.
     * @param into - How it is stored afterwards.
     * @returns The statements, with what the developer has to look at as comments before them.
     */
    private static changeStatements(tableName: string, name: string, from: SnapshotColumn, into: SnapshotColumn): string[] {
        const res: string[] = [];
        if (this.isUnreadable(from) || this.isUnreadable(into)) {
            res.push(
                // eslint-disable-next-line stylistic/max-len
                `// "${name}" of "${tableName}" stores encrypted or hashed values, which a conversion reads as they are stored: check this change`
            );
        }
        const castable: boolean = ValueConversionUtilities.isCastable(from, into);
        if (!castable) {
            res.push(`// ${from.type} has no cast into ${into.type}: list what each value stored in "${name}" of "${tableName}" becomes`);
        }
        res.push(this.call('changePropertyOfEntity', {
            entity: this.tableOf(tableName),
            currentProperty: this.toPropertyLiteral(from, name),
            property: this.toPropertyLiteral(into, name),
            convert: castable ? undefined : { values: new Code('[]'), default: new Code('ValueConversion.NONE') },
            transaction: TRANSACTION
        }));
        return res;
    }

    private static changeKeysStep(tableName: string, className: string): MigrationStep {
        return {
            name: `ChangeKeysOf${className}`,
            description: `Changes the indexes, uniques or checks of "${className}", kept as it declares them once the migrations have run.`,
            entity: className,
            // nothing to call: the data source keeps them as the entities declare them. The migration is
            // what tells a build of this commit from an earlier one of the same release, which would
            // otherwise take a unique away from the instances relying on it
            up: [
                `// the indexes, uniques and checks of "${tableName}" change once the migrations have run:`,
                `// the rows "${tableName}" stores already have to hold to them, so change those that do not here`
            ],
            down: [`// the build reverted to keeps the indexes, uniques and checks of "${tableName}" as its own entities declare them`]
        };
    }

    private static removeRelationStep(join: JoinTableOf): MigrationStep {
        return {
            name: `Remove${this.toPascalCase(join.name)}From${join.className}`,
            description: `Removes the relation "${join.name}" of "${join.className}", with the relations it holds.`,
            entity: join.className,
            up: [this.removeRelationCall(join)],
            down: [`// the relation "${join.name}" of "${join.owner}" comes back without the relations it held`]
        };
    }

    private static addRelationStep(join: JoinTableOf): MigrationStep {
        return {
            name: `Add${this.toPascalCase(join.name)}To${join.className}`,
            description: `Adds the relation "${join.name}" to "${join.className}", kept once the migrations have run.`,
            entity: join.className,
            // the relation is kept as the entities declare it once the migrations have run, the way their
            // indexes are
            up: [],
            down: [this.removeRelationCall(join)]
        };
    }

    private static removeRelationCall(join: JoinTableOf): string {
        return this.call('removeRelationFromEntity', {
            entity: this.tableOf(join.owner),
            relation: { name: join.name, target: this.tableOf(join.target), inverseSide: join.inverseSide },
            transaction: TRANSACTION
        });
    }

    /**
     * Resolves the many to many relations of a snapshot, by the side keeping their join table.
     * @param entities - The entities of the snapshot.
     * @param toTableName - Turns a table name into the one it is compared by.
     * @returns The relations, by what tells them apart.
     */
    private static resolveJoinTables(
        entities: Record<string, SnapshotEntity>,
        toTableName: (tableName: string) => string
    ): Map<string, JoinTableOf> {
        const res: Map<string, JoinTableOf> = new Map();
        for (const [tableName, entity] of ObjectUtilities.entries(entities)) {
            for (const [name, property] of ObjectUtilities.entries(entity.properties)) {
                if (!this.isRelation(property) || property.relation !== Relation.MANY_TO_MANY || property.joinTable !== true) {
                    continue;
                }
                const owner: string = toTableName(tableName);
                const target: string = toTableName(property.target);
                res.set(
                    `${owner}.${name}:${target}.${property.inverseSide}`,
                    { owner, className: entity.className, name, target, inverseSide: property.inverseSide }
                );
            }
        }
        return res;
    }

    // ── the code ────────────────────────────────────────────────

    /**
     * Writes the code of the migration.
     * @param className - The name of its class.
     * @param steps - What it changes.
     * @param input - What it belongs to.
     * @returns The code of the file.
     */
    private static writeCode(className: string, steps: MigrationStep[], input: MigrationGenerationInput): string {
        const up: string[] = steps.flatMap(s => s.up);
        const down: string[] = [...steps].reverse().flatMap(s => s.down);
        const converts: boolean = [...up, ...down].some(s => s.includes('ValueConversion.NONE'));
        const description: string[] = steps.length
            ? steps.map(s => ` * - ${s.description}`)
            : [' * Changes nothing yet: write what it changes, and how to change it back.'];
        return [
            `import { Injectable, Migration, SemVerVersion, Transaction${converts ? ', ValueConversion' : ''} } from 'zibri';`,
            '',
            `import { ${input.current.dataSource} } from '${input.dataSourceImport}';`,
            '',
            '/**',
            ...description,
            ' */',
            '@Injectable()',
            `export class ${className} extends Migration {`,
            `    version: SemVerVersion = '${input.version}';`,
            '',
            '    constructor() {',
            `        super(${input.current.dataSource});`,
            '    }',
            '',
            ...this.writeMethod('up', up, '// what this migration changes'),
            '',
            ...this.writeMethod('down', down, '// how to change it back'),
            '}',
            ''
        ].join('\n');
    }

    /**
     * Writes one direction of the migration.
     * @param method - Which one.
     * @param statements - Its statements and comments.
     * @param placeholder - What it says when it has none.
     * @returns The lines of the method.
     */
    private static writeMethod(method: 'up' | 'down', statements: string[], placeholder: string): string[] {
        const indent: string = ' '.repeat(STATEMENT_INDENT);
        const body: string[] = (statements.length ? statements : [placeholder]).flatMap(s => s.split('\n').map(line => `${indent}${line}`));
        return statements.some(s => s.startsWith('await '))
            ? [`    override async ${method}(transaction: Transaction): Promise<void> {`, ...body, '    }']
            // without the transaction when nothing is handed it, which leaves nothing to await either
            : [
                '    // eslint-disable-next-line typescript/require-await',
                `    override async ${method}(): Promise<void> {`,
                ...body,
                '    }'
            ];
    }

    /**
     * Writes a call of a migration helper.
     * @param helper - The helper.
     * @param input - What it is handed.
     * @returns The statement, over several lines when it does not fit one.
     */
    private static call(helper: string, input: LiteralObject): string {
        const start: string = `await this.dataSource.${helper}(`;
        return `${start}${this.print(input, 0, start.length)});`;
    }

    /**
     * Writes a value as code.
     * @param value - The value.
     * @param indent - Where the line it starts on is indented to, from where the statement starts.
     * @param offset - How far into that line it starts.
     * @returns The code.
     */
    private static print(value: Literal, indent: number, offset: number = 0): string {
        if (value instanceof Code) {
            return value.code;
        }
        if (typeof value === 'string') {
            return `'${value.replaceAll('\\', '\\\\')
                .replaceAll('\'', '\\\'')
                .replaceAll('\n', '\\n')}'`;
        }
        if (typeof value !== 'object') {
            return String(value);
        }
        const members: [string, Literal][] = ObjectUtilities.entries(value)
            .filter((entry): entry is [string, Literal] => entry[1] !== undefined);
        if (!members.length) {
            return '{}';
        }
        const key: (name: string) => string = name => /^[$A-Z_a-z][\w$]*$/.test(name) ? name : this.print(name, indent);
        const member: ([name, v]: [string, Literal], at: number) => string = ([name, v], at) => v instanceof Code && v.code === name
            ? name
            : `${key(name)}: ${this.print(v, at, key(name).length + 2)}`;
        const inline: string = `{ ${members.map(m => member(m, indent)).join(', ')} }`;
        if (STATEMENT_INDENT + indent + offset + inline.length <= MAX_LINE_LENGTH && !inline.includes('\n')) {
            return inline;
        }
        const inner: string = ' '.repeat(indent + 4);
        // eslint-disable-next-line sonar/no-nested-template-literals
        return `{\n${members.map(m => `${inner}${member(m, indent + 4)}`).join(',\n')}\n${' '.repeat(indent)}}`;
    }

    /**
     * Writes the properties of an entity a migration creates, without its relations, and without its
     * primary key where it is the one every entity has.
     * @param entity - The entity.
     * @returns The properties, by name.
     */
    private static toPropertiesLiteral(entity: SnapshotEntity): LiteralObject {
        const defaultKey: SnapshotProperty | undefined = this.resolveDefaultPrimaryKey();
        const res: LiteralObject = {};
        for (const [name, column] of this.columnsOf(entity)) {
            if (name === 'id' && defaultKey != undefined && this.toCanonicalJson(defaultKey) === this.toCanonicalJson(column)) {
                continue;
            }
            res[name] = this.toPropertyLiteral(column);
        }
        return res;
    }

    /**
     * Writes how a property is stored, the way a migration helper takes it.
     * @param column - How it is stored.
     * @param name - Its name, for a helper that takes it.
     * @returns The property.
     */
    private static toPropertyLiteral(column: SnapshotColumn, name?: string): LiteralObject {
        const base: LiteralObject = { name, type: column.type, required: column.required };
        switch (column.type) {
            case 'string': {
                return { ...base, primary: column.primary, format: column.format, maxLength: column.maxLength, enum: column.enum };
            }
            case 'number': {
                return { ...base, primary: column.primary, format: column.format, enum: column.enum };
            }
            case 'array': {
                return { ...base, items: this.toPropertyLiteral(column.items) };
            }
            case 'oneOf': {
                const shapes: LiteralObject = {};
                for (const [shapeName, shape] of ObjectUtilities.entries(column.shapes)) {
                    shapes[shapeName] = this.toPropertyLiteral(shape);
                }
                return { ...base, shapes };
            }
            case 'object': {
                // what an object holds decides nothing about how it is stored, and its class may be gone
                // by the time the migration runs
                return { ...base, cls: new Code('() => Object') };
            }
            case 'file': {
                // what a file may be is checked as it is uploaded, and decides nothing about how it is stored
                return { ...base, allowedMimeTypes: 'all' };
            }
            case 'boolean':
            case 'date':
            case 'unknown': {
                return base;
            }
        }
    }

    // ── names ───────────────────────────────────────────────────

    /**
     * Resolves the name of the migration's class.
     * @param name - The name it is given, if any.
     * @param steps - What it changes, which names it when it is given none.
     * @param takenNames - The names of the migrations the data source has.
     * @returns The name, ending with "Migration", and none of the taken ones.
     */
    private static resolveClassName(name: string | undefined, steps: MigrationStep[], takenNames: string[]): string {
        const base: string = (name == undefined ? this.resolveName(steps) : this.toPascalCase(name)).replace(/Migration$/, '');
        let res: string = `${base}Migration`;
        for (let i: number = 2; takenNames.includes(res); i++) {
            res = `${base}${i}Migration`;
        }
        return res;
    }

    /**
     * Resolves the name of a migration from what it changes.
     * @param steps - What it changes.
     * @returns The name of the one change, or of the entities it changes.
     */
    private static resolveName(steps: MigrationStep[]): string {
        const [only] = steps;
        if (only != undefined && steps.length === 1) {
            return only.name;
        }
        const entities: string[] = [...new Set(steps.map(s => s.entity))];
        if (!entities.length) {
            return 'Empty';
        }
        return `Update${entities.slice(0, 2).join('And')}${entities.length > 2 ? 'AndMore' : ''}`;
    }

    private static toPascalCase(value: string): string {
        return value
            .split(/[^\dA-Za-z]+/)
            .filter(part => part.length)
            .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
            .join('');
    }

    private static toKebabCase(value: string): string {
        return value
            .replaceAll(/([\da-z])([A-Z])/g, '$1-$2')
            .replaceAll(/([A-Z])([A-Z][a-z])/g, '$1-$2')
            .toLowerCase();
    }

    // ── reading snapshots ───────────────────────────────────────

    private static tableOf(tableName: string): LiteralObject {
        return { tableName };
    }

    private static columnsOf(entity: SnapshotEntity): Map<string, SnapshotColumn> {
        const res: Map<string, SnapshotColumn> = new Map();
        for (const [name, property] of ObjectUtilities.entries(entity.properties)) {
            if (!this.isRelation(property)) {
                res.set(name, property);
            }
        }
        return res;
    }

    private static isRelation(property: SnapshotProperty): property is SnapshotRelation {
        return property.type === 'relation';
    }

    private static isUnreadable(column: SnapshotColumn): boolean {
        return column.type === 'string' && (column.encrypted === true || column.hashed === true);
    }

    /**
     * Resolves how the primary key every entity has is stored.
     * @returns How it is stored, or undefined when entities declare their own.
     */
    private static resolveDefaultPrimaryKey(): SnapshotProperty | undefined {
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(BaseEntity)['id'];
        return metadata == undefined ? undefined : EntitySnapshotUtilities.resolveProperty(metadata);
    }

    /**
     * Writes a value as json with its keys sorted, so that two values that are the same compare the same.
     * @param value - The value.
     * @returns The json.
     */
    private static toCanonicalJson(value: unknown): string {
        return JSON.stringify(value, (_, v: unknown) => typeof v === 'object' && v != undefined && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
            : v);
    }
}