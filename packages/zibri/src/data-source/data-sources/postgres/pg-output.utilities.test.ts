import { describe, expect, it } from '@jest/globals';

import { PgOutputUtilities } from './pg-output.utilities';

/**
 * A value of a row as pgoutput writes it: text, null, or a TOASTed value left unchanged.
 */
type WrittenValue = string | null | 'unchanged';

function int8(value: number): Buffer {
    return Buffer.from([value]);
}

function int16(value: number): Buffer {
    const b: Buffer = Buffer.alloc(2);
    b.writeInt16BE(value);
    return b;
}

function int32(value: number): Buffer {
    const b: Buffer = Buffer.alloc(4);
    b.writeInt32BE(value);
    return b;
}

function int64(value: bigint): Buffer {
    const b: Buffer = Buffer.alloc(8);
    b.writeBigUInt64BE(value);
    return b;
}

function text(value: string): Buffer {
    return Buffer.concat([Buffer.from(value), Buffer.from([0])]);
}

function letter(value: string): Buffer {
    return Buffer.from(value, 'ascii');
}

function tuple(values: WrittenValue[]): Buffer {
    return Buffer.concat([
        int16(values.length),
        ...values.map(value => {
            if (value == undefined) {
                return letter('n');
            }
            if (value === 'unchanged') {
                return letter('u');
            }
            const bytes: Buffer = Buffer.from(value);
            return Buffer.concat([letter('t'), int32(bytes.length), bytes]);
        })
    ]);
}

// what pg_logical_slot_peek_binary_changes hands over, written by postgres's pgoutput, protocol 1
describe('PgOutputUtilities', () => {
    it('reads where a transaction commits from its begin', () => {
        const lsn: bigint = (0x16n << 32n) | 0xB3_74_D8_48n;

        expect(PgOutputUtilities.decode(Buffer.concat([letter('B'), int64(lsn), int64(0n), int32(7)]))).toStrictEqual({ kind: 'begin', finalLsn: lsn });
        expect(PgOutputUtilities.formatLsn(lsn)).toBe('16/B374D848');
        expect(PgOutputUtilities.parseLsn('16/B374D848')).toBe(lsn);
    });

    it('reads a table, its columns and which of them name a row', () => {
        const message: Buffer = Buffer.concat([
            letter('R'),
            int32(16_384),
            text('app'),
            text('ünïcode table'),
            int8(100),
            int16(2),
            int8(1),
            text('id'),
            int32(2950),
            int32(-1),
            int8(0),
            text('note'),
            int32(25),
            int32(-1)
        ]);

        expect(PgOutputUtilities.decode(message)).toStrictEqual({
            kind: 'relation',
            relationId: 16_384,
            schema: 'app',
            table: 'ünïcode table',
            columns: [{ name: 'id', key: true }, { name: 'note', key: false }]
        });
    });

    it('reads an insert, an update with and without its old key, a delete and a truncate', () => {
        expect(PgOutputUtilities.decode(Buffer.concat([letter('I'), int32(1), letter('N'), tuple(['a', null, 'line\nbreak'])])))
            .toStrictEqual({ kind: 'insert', relationId: 1, values: [{ kind: 'text', text: 'a' }, { kind: 'null' }, { kind: 'text', text: 'line\nbreak' }] });
        expect(PgOutputUtilities.decode(Buffer.concat([letter('U'), int32(1), letter('N'), tuple(['a', 'unchanged'])])))
            .toStrictEqual({ kind: 'update', relationId: 1, oldValues: undefined, values: [{ kind: 'text', text: 'a' }, { kind: 'unchanged' }] });
        expect(PgOutputUtilities.decode(Buffer.concat([letter('U'), int32(1), letter('K'), tuple(['old', null]), letter('N'), tuple(['new', 'x'])])))
            .toStrictEqual({
                kind: 'update',
                relationId: 1,
                oldValues: [{ kind: 'text', text: 'old' }, { kind: 'null' }],
                values: [{ kind: 'text', text: 'new' }, { kind: 'text', text: 'x' }]
            });
        expect(PgOutputUtilities.decode(Buffer.concat([letter('D'), int32(1), letter('K'), tuple(['gone', null])])))
            .toStrictEqual({ kind: 'delete', relationId: 1, oldValues: [{ kind: 'text', text: 'gone' }, { kind: 'null' }] });
        expect(PgOutputUtilities.decode(Buffer.concat([letter('T'), int32(2), int8(3), int32(1), int32(2)])))
            .toStrictEqual({ kind: 'truncate', relationIds: [1, 2], cascade: true, restartIdentity: true });
    });

    it('passes over what a backup does not read, and refuses a message cut short', () => {
        expect(PgOutputUtilities.decode(Buffer.concat([letter('O'), int64(1n), text('origin')]))).toStrictEqual({ kind: 'other' });
        expect(() => PgOutputUtilities.decode(Buffer.concat([letter('I'), int32(1), letter('N'), tuple(['whole']).subarray(0, 6)])))
            .toThrow('cut short');
        expect(() => PgOutputUtilities.parseLsn('no position')).toThrow('no WAL position');
    });
});