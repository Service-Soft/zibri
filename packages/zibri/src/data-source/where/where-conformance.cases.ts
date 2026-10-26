/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { dropImpossibleConditions } from './drop-impossible-conditions.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { type OneOf } from '../../entity/models/one-of.model';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { ArrayWhereFilter, ObjectArrayWhereFilter } from '../models/where/array-where-filter.model';
import { BooleanWhereFilter } from '../models/where/boolean-where-filter.model';
import { DateWhereFilter } from '../models/where/date-where-filter.model';
import { NumberWhereFilter } from '../models/where/number-where-filter.model';
import { propertyOf } from '../models/where/property-of.function';
import { StringWhereFilter } from '../models/where/string-where-filter.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { Repository } from '../repository/repository';

/**
 * The conformance of every store's reading of a where filter with the one evaluator the repository
 * judges writes by.
 *
 * A filter is one language with several readers: the sql a store renders it to, the evaluator a store
 * filtering in process runs it through, and that same evaluator deciding inside the repository whether
 * a row being written lies inside the caller's scope. The last one decides a security question on
 * every store, so where a store's reading and the evaluator's differ, that store reads one set of rows
 * and lets the caller write another. These cases generate rows and filters over every kind of property
 * and every filter key, and hold each store to the evaluator's answer - and hold the write side to the
 * read side under the same scope. A file per data source runs them against repositories of its own.
 */

/**
 * The scope the probes are restricted to, set by the case that judges writes against reads. Undefined
 * otherwise, which restricts nothing.
 */
let currentScope: Where<Probe> | undefined;

/**
 * The shapes the value of several shapes a probe carries can be.
 */
type ProbeExtraShapes = {
    /**
     * A text.
     */
    Note: string,
    /**
     * A moment.
     */
    Due: Date
};

/**
 * What a probe carries beside its own columns, stored as one json value.
 */
export class ProbeDetails {
    /**
     * A text, when there is one.
     */
    @Property.string({ required: false })
    color?: string;

    /**
     * A number, when there is one.
     */
    @Property.number({ required: false })
    score?: number;
}

/**
 * An item of the list of objects a probe carries.
 */
export class ProbePart {
    /**
     * What the part is called.
     */
    @Property.string()
    name!: string;

    /**
     * How big it is.
     */
    @Property.number()
    size!: number;
}

/**
 * A row holding one property of every kind a filter can name.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: {
        restrictedTo: scopeFor<Probe>(() => currentScope)
    }
})
export class Probe extends BaseEntity {
    /**
     * Groups the probes of one case, so the cases do not read rows of another.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * A text, when there is one.
     */
    @Property.string({ required: false })
    text?: string;

    /**
     * A uuid, when there is one, which a filter may spell in either case.
     */
    @Property.string({ format: 'uuid', required: false })
    owner?: string;

    /**
     * A number, when there is one.
     */
    @Property.number({ required: false })
    amount?: number;

    /**
     * A whole number, when there is one.
     */
    @Property.number({ format: 'integer', required: false })
    count?: number;

    /**
     * A number past what a double holds exactly, when there is one.
     */
    @Property.number({ format: 'bigint', required: false })
    big?: bigint;

    /**
     * A moment, when there is one.
     */
    @Property.date({ required: false })
    when?: Date;

    /**
     * A second moment, when there is one, which a filter compares the first with.
     */
    @Property.date({ required: false })
    until?: Date;

    /**
     * A yes or no, when there is one.
     */
    @Property.boolean({ required: false })
    flag?: boolean;

    /**
     * A list of texts, when there is one.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    tags?: string[];

    /**
     * What it carries beside its own columns.
     */
    @Property.object({ cls: () => ProbeDetails })
    details!: ProbeDetails;

    /**
     * A list of objects, when there is one.
     */
    @Property.array({ items: { type: 'object', cls: () => ProbePart }, required: false })
    parts?: ProbePart[];

    /**
     * A value of one of two shapes, when there is one.
     */
    @Property.oneOf({ shapes: { Note: { type: 'string' }, Due: { type: 'date' } }, required: false })
    extra?: OneOf<ProbeExtraShapes>;

    /**
     * The rows that point at the probe.
     */
    @Property.oneToMany({ target: () => ProbeChild, inverseSide: 'probe', required: false })
    children?: ProbeChild[];
}

/**
 * A row pointing at a probe, or at none.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class ProbeChild extends BaseEntity {
    /**
     * Groups the children of one case, so the cases do not read rows of another.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * What the child is called.
     */
    @Property.string()
    label!: string;

    /**
     * The probe it points at.
     */
    @Property.string({ format: 'uuid', required: false })
    probeId?: string;

    /**
     * That probe.
     */
    @Property.manyToOne({ target: () => Probe, joinColumn: 'probeId', inverseSide: 'children', required: false })
    probe?: Probe;
}

/**
 * The entities the cases need registered.
 */
export const whereConformanceEntities: typeof BaseEntity[] = [Probe, ProbeChild];

/**
 * The repositories the cases run against.
 */
export type WhereConformanceRepositories = {
    /**
     * The probes.
     */
    probes: Repository<Probe>,
    /**
     * Their children.
     */
    children: Repository<ProbeChild>
};

/**
 * A probe as a case writes it: without what the framework fills in, its batch and its children.
 */
type ProbeData = Omit<Probe, keyof BaseEntity | 'batch' | 'children'>;

/**
 * A row of one case, which its batch names.
 */
type Batched = BaseEntity & {
    /**
     * The case the row belongs to.
     */
    batch: string
};

/**
 * How a write of one probe under a scope went, against a read of it under the same scope.
 */
type WriteAndRead = {
    /**
     * Whether the write was refused.
     */
    refused: boolean,
    /**
     * Whether the read finds the row.
     */
    visible: boolean
};

/**
 * Picks from pools the same way on every run, so that a divergence found once is found again.
 */
class Picker {
    private state: number;

    constructor(seed: number) {
        this.state = seed;
    }

    /**
     * Picks one entry of a pool.
     * @param pool - The pool, which is not empty and holds no undefined.
     * @returns The entry.
     * @throws When the pool is empty.
     */
    pick<T>(pool: readonly T[]): T {
        const picked: T | undefined = pool[this.next() % pool.length];
        if (picked === undefined) {
            throw new InternalError('Picked from an empty pool.');
        }
        return picked;
    }

    /**
     * Picks one entry of a pool, or nothing: one row in five holds no value.
     * @param pool - The pool, which is not empty and holds no undefined.
     * @returns The entry, or undefined.
     */
    maybe<T>(pool: readonly T[]): T | undefined {
        return this.next() % 5 === 0 ? undefined : this.pick(pool);
    }

    /**
     * The next number of the sequence: the state shifted and combined with itself three times, the
     * classic 32 bit generator.
     * @returns A whole number.
     */
    private next(): number {
        let x: number = this.state;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.state = x >>> 0;
        return this.state;
    }
}

const d1: Date = new Date('2026-03-01T10:00:00.000Z');
// a moment that is not whole seconds, which a store rounding its timestamps would move
const d2: Date = new Date('2026-03-01T10:00:00.123Z');
const d3: Date = new Date('2026-03-02T10:00:00.000Z');
const d4: Date = new Date('2025-12-31T23:59:59.999Z');

// small pools with a lot of overlap, so that every comparison has rows on both sides of it and a
// value a pattern is written for, plus the empty, the mixed case, the characters a pattern reads
// specially and the texts that spell numbers
const TEXTS: readonly string[] = ['', 'a', 'A', 'ab', 'b', 'a_b', 'a%b', 'ä', '10', '9', 'a\\b'];
const OWNER_A: string = '0b2d4c6e-8a0c-4e2f-9b1d-3f5a7c9e1b3d';
const OWNER_B: string = 'f1e2d3c4-b5a6-4789-8abc-def012345678';
// the second spelling of the first owner, which a write stores in lower case
const OWNERS: readonly string[] = [OWNER_A, OWNER_B, OWNER_A.toUpperCase()];
const AMOUNTS: readonly number[] = [0, 1, -1, 1.5, 9, 10, 100, 0.1];
const COUNTS: readonly number[] = [0, 1, -1, 9, 10];
const LARGE_NUMBERS: readonly bigint[] = [0n, 1n, -1n, 9007199254740993n];
const DATES: readonly Date[] = [d1, d2, d3, d4];
const FLAGS: readonly boolean[] = [true, false];
const TAGS: readonly string[][] = [[], ['a'], ['a', 'b'], ['b', 'c'], ['A'], ['b']];
const PARTS: readonly ProbePart[][] = [
    [],
    [{ name: 'x', size: 1 }],
    [{ name: 'x', size: 2 }, { name: 'y', size: 1 }]
];
const EXTRAS: readonly OneOf<ProbeExtraShapes>[] = [
    { shape: 'Note', value: 'a' },
    { shape: 'Note', value: 'b' },
    { shape: 'Due', value: d1 },
    { shape: 'Due', value: d3 }
];
const CHILD_COUNTS: readonly number[] = [0, 0, 1, 2, 3];
const CHILD_LABELS: readonly string[] = ['x', 'y', 'z'];
// the children that point at no probe
const ORPHAN_LABELS: readonly string[] = ['x', 'y', 'q'];
const PATTERNS: readonly string[] = ['a%', '%b', 'a_b', 'a\\_b', 'a\\%b', '%', '', 'A%', 'ä', 'Ä', '%\\\\%', '_'];

const ROWS: number = 48;
const WRITE_ROWS: number = 24;

/**
 * Generates the probes the cases read.
 * @returns The probes, without their batch.
 */
function generateRows(): ProbeData[] {
    const picker: Picker = new Picker(0x9e3779b9);
    // a picker of its own, so the second moment leaves every other value as it was generated before
    const untilPicker: Picker = new Picker(0x85ebca6b);
    return Array.from({ length: ROWS }, () => ({
        text: picker.maybe(TEXTS),
        owner: picker.maybe(OWNERS),
        amount: picker.maybe(AMOUNTS),
        count: picker.maybe(COUNTS),
        big: picker.maybe(LARGE_NUMBERS),
        when: picker.maybe(DATES),
        until: untilPicker.maybe(DATES),
        flag: picker.maybe(FLAGS),
        tags: picker.maybe(TAGS)?.slice(),
        details: { color: picker.maybe(TEXTS), score: picker.maybe(AMOUNTS) },
        parts: picker.maybe(PARTS)?.map(part => ({ ...part })),
        extra: picker.maybe(EXTRAS)
    }));
}

/**
 * Generates the labels of the children of every probe.
 * @returns The labels, one list per probe.
 */
function generateChildren(): string[][] {
    const picker: Picker = new Picker(0x2545f491);
    return Array.from({ length: ROWS }, () => Array.from({ length: picker.pick(CHILD_COUNTS) }, () => picker.pick(CHILD_LABELS)));
}

/**
 * The filters on a text property, with and without a value.
 */
const TEXT_CONDITIONS: readonly StringWhereFilter[] = [
    ...[...TEXTS, 'zz', null].flatMap((v): StringWhereFilter[] => [v, { not: v }]),
    { oneOf: ['a', 'b'] },
    { oneOf: ['a', null] },
    { oneOf: [null] },
    { oneOf: ['zz'] },
    { oneOf: ['A', 'ä'] },
    { notOneOf: ['a', 'b'] },
    { notOneOf: ['a', null] },
    { notOneOf: [null] },
    ...PATTERNS.flatMap((p): StringWhereFilter[] => [{ like: p }, { iLike: p }, { notLike: p }, { notILike: p }]),
    { like: ['a%', '%b'] },
    { notLike: ['a%', '%b'] },
    { iLike: ['a%', '%B'] },
    { after: 'a' },
    { before: 'b' },
    { after: 'a', before: 'b' },
    { after: '' },
    { before: '' },
    { after: '1' },
    { not: 'a', like: 'a%' }
];

/**
 * The filters on a uuid property, spelled either way, and with a text that is no uuid.
 */
const OWNER_CONDITIONS: readonly StringWhereFilter[] = [
    OWNER_A,
    OWNER_A.toUpperCase(),
    OWNER_B,
    null,
    'nope',
    { not: OWNER_A },
    { not: OWNER_A.toUpperCase() },
    { not: null },
    { oneOf: [OWNER_A, OWNER_B.toUpperCase()] },
    { oneOf: [OWNER_A, 'nope'] },
    { oneOf: ['nope'] },
    { oneOf: [OWNER_A.toUpperCase(), null] },
    { notOneOf: [OWNER_A] },
    { notOneOf: [OWNER_B.toUpperCase(), null] },
    { after: OWNER_A },
    { before: OWNER_B.toUpperCase() }
];

/**
 * The filters on a number property, with and without a value.
 */
const NUMBER_CONDITIONS: readonly NumberWhereFilter<number>[] = [
    ...[...AMOUNTS, 2, null].flatMap((v): NumberWhereFilter<number>[] => [v, { not: v }]),
    { oneOf: [1, 9] },
    { oneOf: [1, null] },
    { oneOf: [null] },
    { oneOf: [2] },
    { notOneOf: [1, 9] },
    { notOneOf: [1, null] },
    { notOneOf: [null] },
    { greaterThan: 1 },
    { greaterThanEquals: 1 },
    { lesserThan: 1 },
    { lesserThanEquals: 1 },
    { greaterThan: 0.5 },
    { lesserThan: 0.5 },
    { greaterThan: -1 },
    { greaterThanEquals: 0, lesserThan: 10 },
    { greaterThan: 0, lesserThan: 0 },
    { greaterThan: 9.5, lesserThanEquals: 100 },
    { not: 1, greaterThan: 0 }
];

/**
 * The filters on a number property that holds whole numbers only, with the values that are none.
 */
const INTEGER_CONDITIONS: readonly NumberWhereFilter<number>[] = [
    ...[...COUNTS, 1.5, null].flatMap((v): NumberWhereFilter<number>[] => [v, { not: v }]),
    { oneOf: [1, 9] },
    { oneOf: [1, null] },
    { oneOf: [1.5] },
    { oneOf: [1, 1.5] },
    { notOneOf: [1, null] },
    { notOneOf: [1.5] },
    { greaterThan: 0 },
    { greaterThan: 0.5 },
    { greaterThan: -0.5 },
    { greaterThanEquals: 0.5 },
    { greaterThanEquals: -0.5 },
    { lesserThan: 0.5 },
    { lesserThan: 9.5 },
    { lesserThanEquals: 0 },
    { lesserThanEquals: 0.5 },
    { greaterThanEquals: 1, lesserThan: 10 },
    { greaterThan: 0.5, lesserThan: 9.5 }
];

/**
 * The filters on a number property that holds numbers past what a double holds exactly.
 */
const BIGINT_CONDITIONS: readonly NumberWhereFilter<bigint>[] = [
    ...[...LARGE_NUMBERS, 2n, null].flatMap((v): NumberWhereFilter<bigint>[] => [v, { not: v }]),
    { oneOf: [1n, 9007199254740993n] },
    { oneOf: [1n, null] },
    { notOneOf: [0n, null] },
    { greaterThan: 0n },
    { greaterThanEquals: 1n },
    { lesserThan: 1n },
    { greaterThan: 9007199254740992n },
    { lesserThanEquals: 9007199254740992n },
    { greaterThan: -1n, lesserThan: 1n }
];

/**
 * The filters on a date property, with and without a value.
 */
const DATE_CONDITIONS: readonly DateWhereFilter[] = [
    ...[...DATES, new Date('2026-03-01T10:00:00.122Z'), null].flatMap((v): DateWhereFilter[] => [v, { not: v }]),
    { oneOf: [d1, d3] },
    { oneOf: [d2, null] },
    { oneOf: [null] },
    { notOneOf: [d1, null] },
    { notOneOf: [null] },
    { after: d1 },
    { afterOrOn: d1 },
    { before: d1 },
    { beforeOrOn: d1 },
    { after: d2 },
    { before: d2 },
    { afterOrOn: d2 },
    { after: d4, before: d3 },
    { afterOrOn: d1, beforeOrOn: d2 },
    { after: d3, before: d1 }
];

/**
 * The filters on a boolean property, with and without a value.
 */
const BOOLEAN_CONDITIONS: readonly BooleanWhereFilter[] = [
    true,
    false,
    null,
    { not: true },
    { not: false },
    { not: null }
];

/**
 * The filters on a list of texts, with and without a list.
 */
const TAG_CONDITIONS: readonly ArrayWhereFilter<string>[] = [
    null,
    [],
    ['a'],
    ['a', 'b'],
    ['b', 'a'],
    ['zz'],
    { not: null },
    { not: ['a'] },
    { not: [] },
    { includes: ['a'] },
    { includes: ['a', 'b'] },
    { includes: ['zz'] },
    { includes: ['A'] },
    { isIncludedIn: ['a', 'b'] },
    { isIncludedIn: ['a'] },
    { isIncludedIn: ['a', 'b', 'c', 'A'] },
    { length: 0 },
    { length: 1 },
    { length: 2 },
    { lengthGreaterThan: 0 },
    { lengthGreaterThanEquals: 2 },
    { lengthLesserThan: 1 },
    { lengthLesserThanEquals: 1 },
    { lengthGreaterThan: 0, lengthLesserThan: 2 },
    { where: 'a' },
    { where: { like: 'a%' } },
    { where: { iLike: 'a' } },
    { where: { not: 'a' } },
    { where: ['a', 'c'] },
    { includes: ['a'], length: 1 }
];

/**
 * The filters on a list of objects, with and without a list.
 */
const PART_CONDITIONS: readonly ObjectArrayWhereFilter<ProbePart>[] = [
    null,
    [],
    [{ name: 'x', size: 1 }],
    [{ name: 'y', size: 1 }, { name: 'x', size: 2 }],
    { not: null },
    { not: [] },
    { not: [{ name: 'x', size: 1 }] },
    { includes: [{ name: 'x', size: 1 }] },
    { includes: [{ name: 'y', size: 1 }] },
    { isIncludedIn: [{ name: 'x', size: 1 }, { name: 'y', size: 1 }] },
    { isIncludedIn: [{ name: 'x', size: 2 }, { name: 'y', size: 1 }] },
    { length: 0 },
    { length: 1 },
    { lengthGreaterThan: 0 },
    { lengthLesserThanEquals: 1 },
    { where: { name: 'x' } },
    { where: { name: 'y' } },
    { where: { name: { like: 'x%' } } },
    { where: { size: { greaterThan: 1 } } },
    { where: { size: 1, name: 'x' } },
    { where: [{ name: 'y' }, { size: 2 }] },
    { where: { name: 'x' }, length: 2 }
];

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoriesOf - Reads the repositories, once the data source is started.
 */
export function describeWhereConformance(dataSourceName: string, repositoriesOf: () => WhereConformanceRepositories): void {
    describe(`what a filter finds against what the evaluator judges, on ${dataSourceName}`, () => {
        const evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();
        const data: ProbeData[] = generateRows();
        const childLabels: string[][] = generateChildren();
        const batch: string = UUIDUtilities.generate();
        // the rows as the store answered the writes, with what the relation reaches attached, which
        // is what the evaluator judges a filter against. Attached one way only, as a resolved relation
        // is: a child names its probe, whose children do not name it back
        let rows: Probe[] = [];
        let children: ProbeChild[] = [];
        let seeded: Promise<void> | undefined;

        /**
         * Writes the rows once, for every case of this data source.
         */
        async function seed(): Promise<void> {
            seeded ??= (async () => {
                rows = await repositoriesOf().probes.createAll(data.map(probe => ({ ...probe, batch })));
                const created: ProbeChild[] = await repositoriesOf().children.createAll([
                    ...rows.flatMap((row, i) => (childLabels[i] ?? []).map(label => ({ label, probeId: row.id, batch }))),
                    ...ORPHAN_LABELS.map(label => ({ label, batch }))
                ]);
                for (const row of rows) {
                    row.children = created.filter(child => child.probeId === row.id);
                }
                children = created.map(child => ({ ...child, probe: rows.find(row => row.id === child.probeId) }));
            })();
            await seeded;
        }

        /**
         * What a row holds, for naming it in a mismatch.
         * @param row - The row.
         * @returns Its values, without what every row has.
         */
        function describeRow(row: Probe): string {
            return JsonUtilities.stringify({
                text: row.text,
                owner: row.owner,
                amount: row.amount,
                count: row.count,
                big: row.big,
                when: row.when,
                until: row.until,
                flag: row.flag,
                tags: row.tags,
                details: row.details,
                parts: row.parts,
                extra: row.extra,
                children: row.children?.map(child => child.label)
            });
        }

        /**
         * What a child holds, for naming it in a mismatch.
         * @param child - The child.
         * @returns Its label and the text of its probe, when it has one.
         */
        function describeChild(child: ProbeChild): string {
            return JsonUtilities.stringify({ label: child.label, probe: child.probe == undefined ? undefined : describeRow(child.probe) });
        }

        /**
         * Narrows a filter to the rows of this case.
         * @param filter - The filter.
         * @returns Every branch of it, with the batch.
         */
        function withBatch<E extends Batched>(filter: Where<E>): WhereFilter<E>[] {
            return (Array.isArray(filter) ? filter : [filter]).map(branch => ({ ...branch, batch }) as WhereFilter<E>);
        }

        /**
         * What the evaluator finds for a filter, read the way the repository hands a filter on: with
         * every uuid in lower case and every branch no row can satisfy dropped.
         * @param where - The branches of the filter.
         * @param stored - The rows it judges.
         * @param cls - Their entity.
         * @returns The ids of the rows it finds, or undefined when it refuses the filter.
         * @throws Whatever else reading the filter throws.
         */
        function evaluated<E extends Batched>(where: WhereFilter<E>[], stored: E[], cls: Newable<E>): Set<string> | undefined {
            let possible: WhereFilter<E>[];
            try {
                possible = dropImpossibleConditions(where, MetadataUtilities.getModelProperties(cls));
            }
            catch (error) {
                if (error instanceof BadRequestError) {
                    return undefined;
                }
                throw error;
            }
            return new Set(stored.filter(row => possible.length > 0 && evaluator.matches(row, possible, cls)).map(row => row.id));
        }

        /**
         * What the store finds for a filter.
         * @param where - The branches of the filter.
         * @param repository - The repository of the rows.
         * @returns The ids of the rows it finds, or undefined when it refuses the filter.
         */
        async function found<E extends Batched>(where: WhereFilter<E>[], repository: Repository<E>): Promise<Set<string> | undefined> {
            try {
                return new Set((await repository.findAll({ where })).map(row => row.id));
            }
            catch (error) {
                if (error instanceof BadRequestError) {
                    return undefined;
                }
                throw error;
            }
        }

        /**
         * Reads what the store finds for every filter, and what the evaluator finds for it, and names
         * the rows the two disagree on - or the filter one of them refuses and the other answers.
         * @param filters - The filters.
         * @param repository - The repository of the rows they read.
         * @param stored - The rows, as the evaluator judges them.
         * @param cls - Their entity.
         * @param describe - Names a row.
         * @returns A line for every filter the two read differently, saying what each found.
         */
        async function mismatchesIn<E extends Batched>(
            filters: Where<E>[],
            repository: Repository<E>,
            stored: E[],
            cls: Newable<E>,
            describe: (row: E) => string
        ): Promise<string[]> {
            await seed();
            const mismatches: string[] = [];
            for (const filter of filters) {
                const where: WhereFilter<E>[] = withBatch(filter);
                const expected: Set<string> | undefined = evaluated(where, stored, cls);
                const read: Set<string> | undefined = await found(where, repository);
                if (expected == undefined || read == undefined) {
                    if (expected !== read) {
                        const refused: string = expected == undefined ? 'evaluator' : 'store';
                        mismatches.push(`${JsonUtilities.stringify(filter)}:\n  the ${refused} refuses it, which the other answers`);
                    }
                    continue;
                }
                const onlyStore: string[] = stored.filter(row => read.has(row.id) && !expected.has(row.id)).map(row => describe(row));
                const onlyEvaluator: string[] = stored.filter(row => expected.has(row.id) && !read.has(row.id)).map(row => describe(row));
                if (onlyStore.length || onlyEvaluator.length) {
                    mismatches.push([
                        `${JsonUtilities.stringify(filter)}:`,
                        ...onlyStore.map(row => `  the store alone finds ${row}`),
                        ...onlyEvaluator.map(row => `  the evaluator alone finds ${row}`)
                    ].join('\n'));
                }
            }
            return mismatches;
        }

        /**
         * The mismatches between the store and the evaluator over the probes.
         * @param filters - The filters.
         * @returns A line for every filter the two read differently.
         */
        async function mismatchesOf(filters: Where<Probe>[]): Promise<string[]> {
            return await mismatchesIn(filters, repositoriesOf().probes, rows, Probe, describeRow);
        }

        /**
         * The mismatches between the store and the evaluator over the children.
         * @param filters - The filters.
         * @returns A line for every filter the two read differently.
         */
        async function childMismatchesOf(filters: Where<ProbeChild>[]): Promise<string[]> {
            return await mismatchesIn(filters, repositoriesOf().children, children, ProbeChild, describeChild);
        }

        it('reads a text the same way', async () => {
            expect(await mismatchesOf(TEXT_CONDITIONS.map(text => ({ text })))).toStrictEqual([]);
        });

        it('reads a uuid the same way, however it is spelled', async () => {
            expect(await mismatchesOf(OWNER_CONDITIONS.map(owner => ({ owner })))).toStrictEqual([]);
        });

        it('reads a number the same way', async () => {
            expect(await mismatchesOf(NUMBER_CONDITIONS.map(amount => ({ amount })))).toStrictEqual([]);
        });

        it('reads a whole number the same way', async () => {
            expect(await mismatchesOf(INTEGER_CONDITIONS.map(count => ({ count })))).toStrictEqual([]);
        });

        it('reads a number past what a double holds exactly the same way', async () => {
            expect(await mismatchesOf(BIGINT_CONDITIONS.map(big => ({ big })))).toStrictEqual([]);
        });

        it('reads a date the same way', async () => {
            expect(await mismatchesOf(DATE_CONDITIONS.map(when => ({ when })))).toStrictEqual([]);
        });

        // 01 §D19: a filter compared a property with a value only, never with another property of the row
        it('compares two properties of a row the same way', async () => {
            expect(await mismatchesOf([
                { when: { after: propertyOf('until') } },
                { when: { afterOrOn: propertyOf('until') } },
                { when: { before: propertyOf('until') } },
                { when: { beforeOrOn: propertyOf('until') } },
                { when: { after: propertyOf('when') } },
                { when: { afterOrOn: propertyOf('when') } },
                { when: { after: propertyOf('until'), before: d3 } },
                { when: { not: d1, beforeOrOn: propertyOf('until') } },
                [{ when: null }, { when: { beforeOrOn: propertyOf('until') } }],
                { when: [{ after: propertyOf('until') }, d4] },
                { amount: { greaterThan: propertyOf('count') } },
                { amount: { greaterThanEquals: propertyOf('count') } },
                { amount: { lesserThan: propertyOf('count') } },
                { amount: { lesserThanEquals: propertyOf('count') } },
                { count: { greaterThan: propertyOf('amount') } },
                { count: { lesserThanEquals: propertyOf('amount'), greaterThan: 0 } },
                { amount: { greaterThan: propertyOf('amount') } },
                { amount: { greaterThan: propertyOf('count') }, when: { before: propertyOf('until') } }
            ])).toStrictEqual([]);
            expect(await childMismatchesOf([
                { probe: { where: { when: { after: propertyOf('until') } } } },
                { probe: { where: { amount: { lesserThan: propertyOf('count') } } }, label: 'x' }
            ])).toStrictEqual([]);
        });

        it('takes a reference to a property of the same kind only, in its type', () => {
            const refused: Where<Probe>[] = [
                // @ts-expect-error a date compared with a number
                { when: { after: propertyOf('amount') } },
                // @ts-expect-error a number compared with a date
                { amount: { greaterThan: propertyOf('when') } },
                // @ts-expect-error a property the entity does not declare
                { when: { before: propertyOf('nowhere') } },
                // @ts-expect-error a reference stands for a value to compare with, never for the value itself
                { when: propertyOf('until') }
            ];
            expect(refused).toHaveLength(4);
        });

        it('reads a yes or no the same way', async () => {
            expect(await mismatchesOf(BOOLEAN_CONDITIONS.map(flag => ({ flag })))).toStrictEqual([]);
        });

        it('reads a list of texts the same way', async () => {
            expect(await mismatchesOf(TAG_CONDITIONS.map(tags => ({ tags })))).toStrictEqual([]);
        });

        it('reads a text and a number inside a json value the same way', async () => {
            expect(await mismatchesOf([
                ...TEXT_CONDITIONS.map((color): Where<Probe> => ({ details: { where: { color } } })),
                ...NUMBER_CONDITIONS.map((score): Where<Probe> => ({ details: { where: { score } } }))
            ])).toStrictEqual([]);
        });

        it('reads a list of objects the same way', async () => {
            expect(await mismatchesOf(PART_CONDITIONS.map(parts => ({ parts })))).toStrictEqual([]);
        });

        it('reads a value of several shapes the same way', async () => {
            expect(await mismatchesOf([
                { extra: null },
                { extra: { whenNote: 'a', whenDue: false } },
                { extra: { whenNote: { like: 'a%' }, whenDue: false } },
                { extra: { whenNote: { not: 'a' }, whenDue: false } },
                { extra: { whenNote: false, whenDue: { after: d1 } } },
                { extra: { whenNote: false, whenDue: d1 } },
                { extra: { whenNote: false, whenDue: { beforeOrOn: d1 } } },
                { extra: { whenNote: {}, whenDue: {} } },
                { extra: { whenNote: {}, whenDue: false } },
                { extra: { whenNote: false, whenDue: false } },
                { extra: { whenNote: 'a', whenDue: d3 } }
            ])).toStrictEqual([]);
        });

        it('reads the rows of a relation the same way', async () => {
            await seed();
            const x: ProbeChild | undefined = rows.flatMap(row => row.children ?? []).find(child => child.label === 'x');
            const y: ProbeChild | undefined = rows.flatMap(row => row.children ?? []).find(child => child.label === 'y');
            if (x == undefined || y == undefined) {
                throw new InternalError('The generated children hold no x or no y.');
            }
            expect(await mismatchesOf([
                { children: { length: 0 } },
                { children: { length: 1 } },
                { children: { lengthGreaterThan: 1 } },
                { children: { lengthLesserThanEquals: 1 } },
                { children: { where: { label: 'x' } } },
                { children: { where: { label: { like: 'x%' } } } },
                { children: { where: { label: { not: 'x' } } } },
                { children: { where: { label: { notOneOf: ['x', 'y'] } } } },
                { children: { where: { label: { notLike: 'x%' } } } },
                { children: { where: [{ label: 'x' }, { label: 'z' }] } },
                { children: { where: { label: 'x' }, length: 2 } },
                { children: { includes: [x] } },
                { children: { includes: [x, y] } },
                { children: { isIncludedIn: [x, y] } },
                { children: { isIncludedIn: [x] } },
                { children: [{ length: 0 }, { where: { label: 'z' } }] }
            ])).toStrictEqual([]);
        });

        it('reads the row of a relation the same way, for a row pointing at none too', async () => {
            await seed();
            const first: Probe | undefined = rows[0];
            if (first == undefined) {
                throw new InternalError('No rows were generated.');
            }
            expect(await childMismatchesOf([
                { probe: { is: null } },
                { probe: { not: null } },
                { probe: { is: first } },
                { probe: { not: first } },
                { probe: { oneOf: [first, null] } },
                { probe: { notOneOf: [first] } },
                { probe: { where: { text: 'a' } } },
                { probe: { where: { text: { not: 'a' } } } },
                { probe: { where: { text: null } } },
                { probe: { where: { text: { notLike: 'a%' } } } },
                { probe: { where: { flag: { not: true } } } },
                { probe: { where: [{ text: 'a' }, { flag: true }] } },
                { probe: { where: { count: 1.5 } } },
                { probe: { where: { children: { length: 2 } } } },
                { probe: { where: { children: { where: { label: { not: 'x' } } } } } },
                { probe: [{ where: { text: 'a' } }, { is: null }] },
                { probe: { where: { text: 'a' } }, label: 'x' }
            ])).toStrictEqual([]);
        });

        it('reads several conditions the same way', async () => {
            expect(await mismatchesOf([
                [{ text: 'a' }, { amount: 1 }],
                [{ text: 'a' }, { text: 'b' }, { flag: true }],
                { text: ['a', { like: 'b%' }] },
                { amount: [1, { greaterThan: 9 }] },
                { text: { like: 'a%' }, flag: true },
                { text: { like: 'a%' }, amount: { greaterThan: 0 }, flag: { not: null } },
                { details: { where: { color: 'a', score: { greaterThan: 0 } } } },
                { details: { where: [{ color: 'a' }, { score: 1 }] } },
                { tags: { includes: ['a'] }, parts: { length: 1 } },
                { when: { after: d1 }, children: { length: 0 } },
                [{ tags: null }, { parts: null }, { extra: null }]
            ])).toStrictEqual([]);
        });

        it('answers a value no row can hold the way the evaluator does', async () => {
            await seed();
            const first: Probe | undefined = rows[0];
            if (first == undefined) {
                throw new InternalError('No rows were generated.');
            }
            // a text that is no uuid names no row, which is answered without asking the store
            expect(await mismatchesOf([
                { id: 'nope' },
                { id: { oneOf: [first.id, 'nope'] } },
                { id: { oneOf: ['nope'] } },
                { id: [first.id, 'nope'] },
                { id: first.id.toUpperCase() }
            ])).toStrictEqual([]);
        });
    });

    describe(`what a write may create against what a read finds, on ${dataSourceName}`, () => {
        const data: ProbeData[] = generateRows().slice(0, WRITE_ROWS);

        /**
         * The scopes the writes are judged under: a sample of every kind of filter, which is what an
         * entity's scope is.
         */
        const scopes: Where<Probe>[] = [
            ...TEXT_CONDITIONS.filter((_, i) => i % 6 === 0).map((text): Where<Probe> => ({ text })),
            ...OWNER_CONDITIONS.map((owner): Where<Probe> => ({ owner })),
            ...NUMBER_CONDITIONS.filter((_, i) => i % 5 === 0).map((amount): Where<Probe> => ({ amount })),
            ...BIGINT_CONDITIONS.filter((_, i) => i % 4 === 0).map((big): Where<Probe> => ({ big })),
            ...DATE_CONDITIONS.filter((_, i) => i % 4 === 0).map((when): Where<Probe> => ({ when })),
            ...BOOLEAN_CONDITIONS.map((flag): Where<Probe> => ({ flag })),
            ...TAG_CONDITIONS.filter((_, i) => i % 4 === 0).map((tags): Where<Probe> => ({ tags })),
            ...PART_CONDITIONS.filter((_, i) => i % 3 === 0).map((parts): Where<Probe> => ({ parts })),
            { details: { where: { color: { like: 'a%' } } } },
            { details: { where: { score: { greaterThan: 0 } } } },
            { extra: { whenNote: { like: 'a%' }, whenDue: false } },
            [{ text: 'a' }, { amount: 1 }],
            { text: { like: 'a%' }, flag: true }
        ];

        /**
         * Writes one probe under the scope set, and reads it back under the same scope.
         * @param probe - The probe.
         * @param batch - The batch to write it under.
         * @returns Whether the write was refused, and whether the read finds the row. A refused row
         * is written past the scope, so the read has one to find or not.
         */
        async function writeAndRead(probe: ProbeData, batch: string): Promise<WriteAndRead> {
            let refused: boolean = false;
            let created: Probe;
            try {
                created = await repositoriesOf().probes.create({ ...probe, batch });
            }
            catch (error) {
                if (!(error instanceof ForbiddenError)) {
                    throw error;
                }
                refused = true;
                created = await repositoriesOf().probes.create({ ...probe, batch }, { unscoped: true });
            }
            return { refused, visible: await repositoriesOf().probes.exists({ where: { id: created.id } }) };
        }

        /**
         * Writes every probe under one scope, and names the ones the write and the read disagree on.
         * @param scope - The scope.
         * @returns A line for every probe the write took and the read does not find, or the other way round.
         */
        async function mismatchesUnder(scope: Where<Probe>): Promise<string[]> {
            const mismatches: string[] = [];
            const batch: string = UUIDUtilities.generate();
            currentScope = scope;
            try {
                for (const probe of data) {
                    const { refused, visible } = await writeAndRead(probe, batch);
                    if (visible === refused) {
                        mismatches.push(
                            `under ${JsonUtilities.stringify(scope)} the write ${refused ? 'refused' : 'took'} `
                            + `${JsonUtilities.stringify(probe)}, which the read ${visible ? 'finds' : 'does not find'}`
                        );
                    }
                }
            }
            finally {
                currentScope = undefined;
            }
            return mismatches;
        }

        it('refuses to create exactly the rows a read under the same scope cannot see', async () => {
            const mismatches: string[] = [];
            for (const scope of scopes) {
                mismatches.push(...await mismatchesUnder(scope));
            }
            expect(mismatches).toStrictEqual([]);
        }, 120000);
    });
}