import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { AuditEntry } from '../../audit/audit-entry.model';
import { RecordedAuditEntry } from '../../audit/base-audit-entry.model';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { OmitStrict } from '../../types/omit-strict.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { ChainUtilities } from './chain.utilities';

const KEY: Buffer = randomBytes(32);

const OCCURRED_AT: Date = new Date('2026-11-26T09:30:00.000Z');

/**
 * An entry as a trail of 3.2 stored it, without the columns added since.
 */
const STORED_BEFORE: OmitStrict<RecordedAuditEntry, 'userKind' | 'approvalRequestId'> & { recordedAt: Date } = {
    tenantId: null,
    action: AuditAction.LOGIN,
    outcome: AuditOutcome.SUCCESS,
    reason: null,
    subject: 'ada@example.com',
    userId: '3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21',
    scopes: null,
    role: null,
    clientIp: '203.0.113.7',
    traceId: null,
    occurredAt: OCCURRED_AT,
    lastOccurredAt: OCCURRED_AT,
    count: 1,
    collapsed: null,
    recordedAt: OCCURRED_AT
};

/**
 * The keyed hash a release of 3.2 wrote for an entry: over every column it had, by name, without the id and the hash.
 * @param row - The entry.
 * @returns The hash.
 */
function resolveMacOfThreeTwo(row: typeof STORED_BEFORE): string {
    const columns: string[] = Object.keys(row).sort();
    const content: string = JsonUtilities.stringify(columns.map(column => {
        const value: unknown = Reflect.get(row, column);
        return [column, value instanceof Date ? value.toISOString() : value ?? null];
    }));
    return createHmac('sha256', KEY).update(JsonUtilities.stringify(['mac', ChainUtilities.getTableName(AuditEntry), content]))
        .digest('base64url');
}

describe('ChainUtilities', () => {
    it('hashes a row stored before a release added columns to its entity as it was hashed then', () => {
        const mac: string = resolveMacOfThreeTwo(STORED_BEFORE);

        expect(ChainUtilities.resolveRowMac(KEY, AuditEntry, STORED_BEFORE, 'mac')).toBe(mac);
        // read back from a table the columns were added to, holding nothing
        expect(ChainUtilities.resolveRowMac(KEY, AuditEntry, { ...STORED_BEFORE, userKind: null, approvalRequestId: null }, 'mac')).toBe(mac);
    });

    it('hashes an added column once it holds a value, so writing one in is told apart', () => {
        expect(ChainUtilities.resolveRowMac(KEY, AuditEntry, { ...STORED_BEFORE, userKind: 'service' }, 'mac'))
            .not.toBe(resolveMacOfThreeTwo(STORED_BEFORE));
    });
});