// Fixture: completes with the tenant the job was handed, so the test can compare it with the tenant
// the job was queued in.
import { getThreadJobTenantId, reportCompletion } from './worker/helpers';

reportCompletion(getThreadJobTenantId() ?? 'no tenant');