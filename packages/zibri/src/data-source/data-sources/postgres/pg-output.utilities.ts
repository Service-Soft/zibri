import { PgOutputColumn, PgOutputMessage, PgOutputValue } from './pg-output-message.model';
import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * The bit of a column's flags in a relation message saying it is part of the replica identity.
 */
const KEY_COLUMN_FLAG: number = 1;

/**
 * The bits of a truncate message's options.
 */
const TRUNCATE_CASCADE_FLAG: number = 1;
const TRUNCATE_RESTART_IDENTITY_FLAG: number = 2;

/**
 * Where a message is being read.
 */
type MessageReader = {
    /**
     * The message read.
     */
    message: Buffer,
    /**
     * Where in the message the next value starts.
     */
    offset: number
};

/**
 * Reads the messages of postgres's built-in logical decoding plugin, pgoutput, in protocol version 1, and
 * the WAL positions they carry.
 */
export abstract class PgOutputUtilities {
    /**
     * Reads one message.
     * @param message - The message, as `pg_logical_slot_peek_binary_changes` hands it over.
     * @returns The message.
     * @throws When the message is cut short.
     */
    static decode(message: Buffer): PgOutputMessage {
        const reader: MessageReader = { message, offset: 1 };
        switch (String.fromCodePoint(message[0] ?? 0)) {
            case 'B': {
                return { kind: 'begin', finalLsn: this.readInt64(reader) };
            }
            case 'C': {
                return { kind: 'commit' };
            }
            case 'R': {
                const relationId: number = this.readInt32(reader);
                const schema: string = this.readString(reader);
                const table: string = this.readString(reader);
                // the table's replica identity setting, which each column's flag says the effect of
                this.readInt8(reader);
                const columns: PgOutputColumn[] = Array.from({ length: this.readInt16(reader) }, () => {
                    const flags: number = this.readInt8(reader);
                    const name: string = this.readString(reader);
                    // the column's type and its modifier: a value is written back as text, which postgres
                    // reads as the column's type
                    this.readInt32(reader);
                    this.readInt32(reader);
                    return { name, key: (flags & KEY_COLUMN_FLAG) !== 0 };
                });
                return { kind: 'relation', relationId, schema, table, columns };
            }
            case 'I': {
                const relationId: number = this.readInt32(reader);
                this.readTupleKind(reader, ['N']);
                return { kind: 'insert', relationId, values: this.readTuple(reader) };
            }
            case 'U': {
                const relationId: number = this.readInt32(reader);
                const kind: string = this.readTupleKind(reader, ['K', 'O', 'N']);
                const oldValues: PgOutputValue[] | undefined = kind === 'N' ? undefined : this.readTuple(reader);
                if (oldValues != undefined) {
                    this.readTupleKind(reader, ['N']);
                }
                return { kind: 'update', relationId, oldValues, values: this.readTuple(reader) };
            }
            case 'D': {
                const relationId: number = this.readInt32(reader);
                this.readTupleKind(reader, ['K', 'O']);
                return { kind: 'delete', relationId, oldValues: this.readTuple(reader) };
            }
            case 'T': {
                const count: number = this.readInt32(reader);
                const options: number = this.readInt8(reader);
                return {
                    kind: 'truncate',
                    relationIds: Array.from({ length: count }, () => this.readInt32(reader)),
                    cascade: (options & TRUNCATE_CASCADE_FLAG) !== 0,
                    restartIdentity: (options & TRUNCATE_RESTART_IDENTITY_FLAG) !== 0
                };
            }
            default: {
                return { kind: 'other' };
            }
        }
    }

    /**
     * Writes a WAL position the way postgres does, as two hexadecimal halves.
     * @param lsn - The position.
     * @returns The position as text, such as `16/B374D848`.
     */
    static formatLsn(lsn: bigint): string {
        return `${(lsn >> 32n).toString(16).toUpperCase()}/${(lsn & 0xFF_FF_FF_FFn).toString(16).toUpperCase()}`;
    }

    /**
     * Reads a WAL position written the way postgres does.
     * @param lsn - The position as text, such as `16/B374D848`.
     * @returns The position.
     * @throws When the text is no position.
     */
    static parseLsn(lsn: string): bigint {
        const match: RegExpExecArray | null = /^([\dA-Fa-f]{1,8})\/([\dA-Fa-f]{1,8})$/.exec(lsn);
        if (match?.[1] == undefined || match[2] == undefined) {
            throw new InternalError(`"${lsn}" is no WAL position.`);
        }
        return (BigInt(`0x${match[1]}`) << 32n) | BigInt(`0x${match[2]}`);
    }

    private static readTupleKind(reader: MessageReader, expected: string[]): string {
        const kind: string = String.fromCodePoint(this.readInt8(reader));
        if (!expected.includes(kind)) {
            throw new InternalError(`A pgoutput message holds a row marked "${kind}" where it holds one of ${expected.join(', ')}.`);
        }
        return kind;
    }

    private static readTuple(reader: MessageReader): PgOutputValue[] {
        return Array.from({ length: this.readInt16(reader) }, (): PgOutputValue => {
            const kind: string = String.fromCodePoint(this.readInt8(reader));
            switch (kind) {
                case 'n': {
                    return { kind: 'null' };
                }
                case 'u': {
                    return { kind: 'unchanged' };
                }
                case 't': {
                    const length: number = this.readInt32(reader);
                    this.validateLength(reader, length);
                    const text: string = reader.message.toString('utf8', reader.offset, reader.offset + length);
                    reader.offset += length;
                    return { kind: 'text', text };
                }
                default: {
                    // binary values only come when asked for, which a backup does not
                    throw new InternalError(`A pgoutput message holds a value marked "${kind}", which a backup does not read.`);
                }
            }
        });
    }

    private static readString(reader: MessageReader): string {
        const end: number = reader.message.indexOf(0, reader.offset);
        if (end < 0) {
            throw new InternalError('A pgoutput message is cut short inside a name.');
        }
        const text: string = reader.message.toString('utf8', reader.offset, end);
        reader.offset = end + 1;
        return text;
    }

    private static readInt8(reader: MessageReader): number {
        this.validateLength(reader, 1);
        return reader.message.readUInt8(reader.offset++);
    }

    private static readInt16(reader: MessageReader): number {
        this.validateLength(reader, 2);
        const value: number = reader.message.readInt16BE(reader.offset);
        reader.offset += 2;
        return value;
    }

    private static readInt32(reader: MessageReader): number {
        this.validateLength(reader, 4);
        const value: number = reader.message.readInt32BE(reader.offset);
        reader.offset += 4;
        return value;
    }

    private static readInt64(reader: MessageReader): bigint {
        this.validateLength(reader, 8);
        const value: bigint = reader.message.readBigUInt64BE(reader.offset);
        reader.offset += 8;
        return value;
    }

    private static validateLength(reader: MessageReader, length: number): void {
        if (reader.offset + length > reader.message.length) {
            throw new InternalError('A pgoutput message is cut short.');
        }
    }
}