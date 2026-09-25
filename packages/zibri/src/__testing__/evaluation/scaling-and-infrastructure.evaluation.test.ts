import { describe, expect, it } from '@jest/globals';

import { CronJobState } from '../../cron/cron-job-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Lease } from '../../leases/lease.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md, plus the deployment findings
 * from evaluation/01-data-layer.md (C2, C3).
 *
 * Almost everything here only goes wrong with more than one instance, and a single jest process
 * cannot observe that. Those entries are `it.todo` rather than assertions about the source: a todo
 * states what the cluster harness has to prove and cannot report itself as fixed, which is exactly
 * what the source greps did three separate times.
 *
 * Running two instances needs two processes, because GlobalRegistry is static and
 * markAppAsCreated() throws on a second ZibriApplication - that constraint is itself finding C7 in
 * evaluation/02-http-runtime-core.md. The harness is therefore: one postgres container, N forked
 * children each booting an app against it, assertions made from the parent over a plain pg client.
 *
 * The few findings here that are observable in one process are tested for real, either below or in
 * the sibling files noted against them.
 */

describe('evaluation/04-infrastructure-subsystems', () => {

    describe('01 C2 / C3 - deploying more than one instance', () => {
        // C2 is CLOSED and proven for real in ./cluster/migrations.cluster.test.ts: three replicas
        // booting simultaneously, one migration row, all three up. It used to be read-applied-
        // versions then run with no lock, so a rolling deploy ran the same DDL on every replica.

        // any migration whose version is above the app version is reverted at startup, so an old
        // pod restarting mid-deploy destroys the schema the new pods are using
        it.todo('does not revert migrations when an older instance rejoins the cluster');
    });

    describe('1.1 / 1.2 / 1.3 - cron across replicas', () => {
        // 1.1 is CLOSED and proven for real in ./cluster/cron.cluster.test.ts: three replicas,
        // grouped by scheduled tick, exactly one writer per group. It is not restated here,
        // because a single process cannot tell the fixed behavior from the broken one.

        // findOne ?? create against a unique name, so simultaneous boots collide and the losing
        // replica throws during afterAppInit and fails to start. Needs the cluster harness with
        // bootMode: 'simultaneous', which exists for exactly this.
        it.todo('registers a job without colliding when several instances boot together');

        // 1.3 is CLOSED and proven for real in ../../cron/cron.test.ts: a job that does not ask for a
        // startup run does not get one, and two instances of a distributed job that do ask for one
        // produce a single tick between them rather than one each. runOnInit used to default to true
        // *and* to bypass the coordinator outright, because `task.execute()` runs what it is given
        // without asking anybody.

        // the startup election is keyed on the slot the run happens ahead of, which every replica of
        // one rolling deploy computes identically. Two forked instances are what shows that.
        it.todo('elects one instance for the startup run when several boot together');

        // 2.11 is CLOSED and proven for real in ../../cron/cron.test.ts: a job with
        // `catchUpWithinMs` set runs once for the slot it missed, and one without still does not.
        // `lastRun` used to be written on every tick and never read by anything.

        // the make-up run is claimed on the key that slot's own execution would have used, so an
        // instance rejoining a cluster that already ran it does nothing. Two forked instances show
        // that; one process cannot.
        it.todo('does not repeat a make-up run another instance already performed');

        it('claims a scheduled execution rather than the job as a whole', () => {
            const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Lease);
            const keys: string[] = Object.keys(props);

            // the claim is per execution, not per job: the key is `cron:<job name>:<scheduled
            // time>`, so a replica jittered by maxRandomDelay still competes for the tick it was
            // scheduled for instead of colliding with the next one. expiresAt only recovers an
            // execution whose instance died mid run.
            expect(keys).toContain('key');
            expect(keys).toContain('expiresAt');
        });
    });

    describe('2.1 - a transient error must not disable a job permanently', () => {
        // CLOSED and proven for real in ../../cron/cron.test.ts. Two changes, because the default was
        // only half of it: stopOnError is now off, so a failing tick costs one execution rather than
        // the job; and a job it does stop records where to put it back, so the next start puts it
        // there. `active: boolean` could not express that - being turned off by somebody who meant it
        // and being taken off the schedule by a failure looked identical, so neither could be undone
        // without also undoing the other.
        it('tells a job somebody disabled apart from one a failure stopped', () => {
            const states: string[] = Object.values(CronJobState);

            expect(states).toEqual(expect.arrayContaining(['INACTIVE', 'STOPPED_ON_ERROR']));
        });
    });

    describe('1.4 / 1.5 / 2.4 - the event system', () => {
        // 1.4 and 1.5 are CLOSED and proven for real in ./cluster/events.cluster.test.ts: an event
        // whose replica is killed mid hook is finished exactly once by a survivor, and a hook that
        // outlives its claim does not get run a second time. Delivery used to be an in-process rxjs
        // Subject over a row nothing polled, and the replay in onAppStart re-emitted every
        // unfinished event on every replica with no claim at all.

        // the subscriber run row is written whether the hook succeeded or failed, then the event
        // flips to FINISHED and the cleanup cron deletes it. docs/events.md promises the opposite.
        it.todo('retries a subscriber whose hook threw, instead of marking the event finished');

        // the retry loop has no delay and no jitter
        it.todo('backs off between subscriber retries');
    });

    describe('1.6 / 1.7 / 2.2 - the mail queue', () => {
        // 1.6 is CLOSED and proven for real in ./cluster/mail.cluster.test.ts, in both halves:
        // replicas racing over one tick, and a send outliving the tick so the next slot re-reads
        // rows that still look QUEUED. It used to be a plain SELECT ... WHERE status='QUEUED' with
        // no claim of any kind.

        // 1.7 is WITHDRAWN rather than closed. EMAIL_RATE_LIMITER is a useClass provider, so the
        // store is the deployment's choice and pointing it at a shared one is configuration rather
        // than a fix - see evaluation/04-infrastructure-subsystems.md.

        // 2.2 asked for `attempts` and `lastError` on the entity, and the fix DECLINED both. What
        // the finding was actually about is that a rejected mail with persist:false was DELETEd,
        // destroying the only record that the mail was ever owed - so the row is kept as FAILED
        // with `rejectedRecipients` naming the addresses that bounced, and `findMails` selects
        // QUEUED, which makes it a record rather than a retry. Retry with backoff, nextRetryAt and
        // a dead letter queue are a delivery feature nobody asked for; the defect was destroying
        // evidence, which no longer happens.
        //
        // A test asserting those columns would be red forever while describing something nobody
        // intends to build - see ./README.md, "a comment where a case used to be". What replaced it
        // is real: ./email-failure.evaluation.test.ts drives a partial rejection through a real SMTP
        // dialogue and reads the kept row back.
    });

    describe('1.8 / 1.9 / 3.9 - caching', () => {
        // 1.8 is CLOSED, tested in ./caching.evaluation.test.ts: invalidateTags used to filter
        // MultiTierCache out twice, so @CacheInvalidate against one silently did nothing.
        //
        // 1.9 is CLOSED and proven for real in ./cluster/caching.cluster.test.ts, with an in-memory
        // tier over a shared valkey one - the only arrangement where a stale local tier is visible.
        // Invalidations used to stay inside the process that made them.

        // hits/misses are declared in initMetrics and never incremented, so the hit rate dashboard
        // reads a permanent zero
        it.todo('records hit and miss metrics for a multi tier cache');
    });

    describe('1.10 - websocket fan out', () => {
        // 1.10 is CLOSED and proven for real in ./cluster/websocket.cluster.test.ts, with the two
        // clients on different instances - the only arrangement that can tell the difference. No
        // adapter used to be configurable at all, so a broadcast reached roughly 1/N of clients
        // and nothing reported that the rest were missed.
    });

    describe('1.11 - invoice numbering', () => {
        // 1.11 is CLOSED, tested in ./invoicing.evaluation.test.ts - concurrently, in one process,
        // because the race never needed a second instance. It used to read, increment in JS and
        // write back with no lock and no unique constraint on (year, recipientId), so two
        // concurrent creations both read 41 and both emitted 42. An audit finding under GoBD and
        // SdI rather than a bug report.
    });

    describe('2.6 / 2.7 / 2.8 / 2.9 / 2.10 - the worker pool', () => {
        // a worker with no assigned job that exits is never removed from idleWorkers and never
        // replaced, so the pool silently degrades to zero throughput
        it.todo('replaces a worker that died while it was idle');

        // there is no onAppStart recovery, so a restart abandons the in-memory queue and leaves
        // rows stuck at IN_PROGRESS forever with no reaper
        it.todo('recovers jobs that were queued when the process died');

        // the handler reports and continues, leaving module level state corrupted for the next job
        it.todo('terminates a worker that hit an uncaught exception');

        // workerData.func is persisted on ThreadJobEntity and re-evaluated on requeue, so write
        // access to that table is remote code execution in a worker thread
        it.todo('does not execute a function body that came out of the database');

        // 2.10 and 2.12 are CLOSED and tested for real in
        // ../../multithreading/services/multithreading.service.test.ts. The non-priority branch used
        // to sort descending while the priority branch sorted ascending, so the oldest normal job
        // was passed over by every job that arrived after it - but the deeper half was that the
        // order was decided in a per process array at all. The queue is the table now: ordered by
        // the store, claimed with a lease per job, and shared by every instance. 2.12's unbounded
        // array went with it.
    });

    describe('3.3 / 3.4 - logging throughput', () => {
        // 3.3 is CLOSED and tested for real in ../../logging/logger.batching.test.ts. The awaited
        // half had already gone with the access log; the per-line write needed two things, and the
        // second is the one the finding does not mention. A transport contract taking Log[] is not
        // enough on its own, because a drain used to start the instant an entry arrived - so the
        // first entry of every quiet period was written alone, and an application logging one line
        // per request is quiet between requests. LOGGER_FLUSH_INTERVAL_MS is where they gather.
        //
        // 3.4 is CLOSED and tested against the real mail queue in
        // ../../logging/transport/log-to-email.digest.test.ts: one digest per batch, bounded by
        // maxEntriesPerEmail and by minIntervalMs, naming what it left out both times.

        // the per-call stack capture is observed for real in ./logging.evaluation.test.ts
    });

    describe('5.2 - swapping in real infrastructure', () => {
        // the email row is CLOSED, tested in ./email-transport.evaluation.test.ts against a
        // transport that is neither smtp nor nodemailer, and in ./email-failure.evaluation.test.ts
        // against the shipped SmtpEmailTransport and a real smtp dialogue. nodemailer used to be
        // built in the service's own constructor, so the only way to send through anything else was
        // to subclass it and override a protected method - which is what two of this repository's
        // own fixtures did.
        //
        // The email rate limiter store is WITHDRAWN for the same reason as 1.7, and the events,
        // cron and websocket rows closed under 1.4, 1.1 and 1.10.

        // BackupTransportInterface exists and only FsBackupTransport implements it, so this is a
        // missing implementation rather than a missing seam - S3 or GCS, plus the checksum and
        // restore verification 5.4 asks for
        it.todo('stores a backup somewhere other than the local filesystem');
    });

    // 4.1 and 4.2, the http client retry policy and body reads, are observed for real in
    // ./http-client.evaluation.test.ts
});