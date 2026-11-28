import { describe, expect, it } from '@jest/globals';

import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { ApprovalRequestUtilities } from './approval-request.utilities';
import { type ApprovalPrecondition } from './models/approval-precondition.model';

@Entity({ allowOrphan: true })
class ReviewedTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.date({ required: false })
    dueAt?: Date | null;
}

const stored: ReviewedTask = {
    id: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
    tenantId: '3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21',
    title: 'Write the release notes',
    dueAt: new Date('2026-12-01T00:00:00.000Z')
};

describe('ApprovalRequestUtilities', () => {
    it('lists only the values an update changes, a date as the same date however it is written', () => {
        expect(ApprovalRequestUtilities.resolveChange({
            entity: ReviewedTask,
            stored,
            values: { title: 'Publish the release', dueAt: new Date('2026-12-01T00:00:00.000Z') }
        })).toEqual({
            entity: 'reviewed_task',
            id: stored.id,
            changes: [{ key: 'title', previousValue: 'Write the release notes', newValue: 'Publish the release' }]
        });
    });

    it('lists every value of a row the action creates, against none', () => {
        expect(ApprovalRequestUtilities.resolveChange({ entity: ReviewedTask, stored: undefined, values: { title: 'Publish the release' } }))
            .toEqual({ entity: 'reviewed_task', id: null, changes: [{ key: 'title', previousValue: null, newValue: 'Publish the release' }] });
    });

    it('lists every stored value of a row the action deletes, but its id', () => {
        expect(ApprovalRequestUtilities.resolveChange({ entity: ReviewedTask, stored, values: null }).changes.map(change => change.key))
            .toEqual(['dueAt', 'tenantId', 'title']);
    });

    it('finds a row that changed, or is no longer stored, since the request was proposed against it', () => {
        const [precondition] = ApprovalRequestUtilities.resolvePreconditions([{ entity: ReviewedTask, stored, values: {} }]);
        const preconditions: ApprovalPrecondition[] = precondition == undefined ? [] : [precondition];
        const changed: ReviewedTask = { ...stored, title: 'Other' };

        // the same row, read again
        expect(ApprovalRequestUtilities.findBrokenPrecondition(preconditions, [{ entity: ReviewedTask, stored: { ...stored }, values: {} }]))
            .toBeUndefined();
        expect(ApprovalRequestUtilities.findBrokenPrecondition(preconditions, [{ entity: ReviewedTask, stored: changed, values: {} }]))
            .toEqual(precondition);
        expect(ApprovalRequestUtilities.findBrokenPrecondition(preconditions, [{ entity: ReviewedTask, stored: undefined, values: {} }]))
            .toEqual(precondition);
    });
});