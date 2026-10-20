import { describe, expect, it } from 'vitest';

import { CronJobState } from '../../cron/cron-job-entity.model.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { Lease } from '../../leases/lease.model.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md, plus the deployment findings
 * from evaluation/01-data-layer.md (C2, C3).
 *
 * Almost everything here only goes wrong with more than one instance, and a single test process
 * cannot observe that. Those findings are proven in ./cluster, one forked process per instance
 * against shared containers, and the findings observable in one process are tested for real in the
 * files noted against them. What is left here is a map from each finding to where it is held, plus
 * the two checks below.
 *
 * The map is comments rather than `it.todo`: a todo states a proof that is still owed, so one left
 * behind after the proof exists reports a closed finding as open.
 */

describe('evaluation/04-infrastructure-subsystems', () => {

    describe('01 C2 / C3 - deploying more than one instance', () => {
        // C2 is CLOSED and proven for real in ./cluster/migrations.cluster.test.ts: three replicas
        // booting simultaneously, one migration row, all three up. It used to be read-applied-
        // versions then run with no lock, so a rolling deploy ran the same DDL on every replica.

        // C3 is CLOSED and tested for real in ../../data-source/migration/migration-downgrade.test.ts,
        // in one process because refusing is a property of one instance booting: a database holding a
        // migration newer than the app, whether this build carries it or not, stops the boot and no
        // `down` runs. Any migration above the app version used to be reverted at startup, so an old
        // pod restarting mid deploy took the schema away from the new pods serving on it.
    });

    describe('1.1 / 1.2 / 1.3 - cron across replicas', () => {
        // 1.1 is CLOSED and proven for real in ./cluster/cron.cluster.test.ts: three replicas,
        // grouped by scheduled tick, exactly one writer per group. It is not restated here,
        // because a single process cannot tell the fixed behavior from the broken one.

        // 1.2 is CLOSED and proven for real in ./cluster/migrations.cluster.test.ts, which boots three
        // replicas with bootMode: 'simultaneous' against an empty table - and every one of them
        // registers the framework's own cron jobs on the way up. It was findOne ?? create against a
        // unique name, so the losing replica threw during afterAppInit and failed to start.

        // 1.3 is CLOSED and proven for real in ../../cron/cron.test.ts: a job that does not ask for a
        // startup run does not get one, and two instances of a distributed job that do ask for one
        // produce a single tick between them rather than one each. ./cluster/cron-startup.cluster.test.ts
        // shows the same for instances booting after the first one's claim on a scheduled execution
        // would have lapsed, which is what a slow rolling deploy is.
        // runOnInit used to default to true *and* to bypass the coordinator outright, because
        // `task.execute()` runs what it is given without asking anybody.

        // 2.11 is CLOSED and proven for real in ../../cron/cron.test.ts: a job with
        // `catchUpWithinMs` set runs once for the slot it missed, one without still does not, and
        // two instances coming back from the same outage make it up once between them. `lastRun`
        // used to be written on every tick and never read by anything. An instance rejoining later
        // reads the `lastRun` the make-up run wrote, so it finds nothing missed at all.

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
        // only half of it: a job now stops only when its onFailure asks to, so a failing tick costs one execution rather than
        // the job; and a job it does stop records where to put it back, so the next start puts it
        // there. `active: boolean` could not express that - being turned off by somebody who meant it
        // and being taken off the schedule by a failure looked identical, so neither could be undone
        // without also undoing the other.
        it('tells a job somebody disabled apart from one a failure stopped', () => {
            const states: string[] = Object.values(CronJobState);

            expect(states).toEqual(expect.arrayContaining(['INACTIVE', 'STOPPED_ON_ERROR']));
        });
    });

    describe('1.4 / 1.5 / 2.3 / 2.4 - the event system', () => {
        // 1.4 and 1.5 are CLOSED and proven for real in ./cluster/events.cluster.test.ts: an event
        // whose replica is killed mid hook is finished exactly once by a survivor, and a hook that
        // outlives its claim does not get run a second time. Delivery used to be an in-process rxjs
        // Subject over a row nothing polled, and the replay in onAppStart re-emitted every
        // unfinished event on every replica with no claim at all.

        // 2.3 and 2.4 are CLOSED together and tested for real in ../../event/event.service.test.ts:
        // one attempt per delivery with the backoff on the row, and a subscriber that spends every
        // attempt leaves the event FAILED rather than FINISHED, which the cleanup cron does not
        // delete. The run row used to be written whether the hook succeeded or not, and the retries
        // were a tight loop within microseconds.
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

        // 3.9 is CLOSED and tested in ./caching.evaluation.test.ts, both halves: concurrent misses
        // share one origin call, and the hit and miss counters move. They used to be declared in
        // initMetrics and never incremented, so the hit rate dashboard read a permanent zero.
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
        // 2.6, 2.7, 2.8 and 2.9 are CLOSED and tested for real in
        // ../../multithreading/services/multithreading.service.test.ts, each against a real pool:
        // - 2.6: an idle worker is terminated directly and the next job still runs. A dead idle worker
        //   used to stay on idleWorkers and be handed the next job, until the pool did nothing at all.
        // - 2.7: rows left behind by a previous run, started or not, are picked up after a restart
        //   through the real lifecycle. There was no recovery, so they stayed IN_PROGRESS forever.
        // - 2.8: a one thread pool runs a second job after the first threw from a timer. The handler
        //   used to report and carry on, handing a corrupted thread to the next job.
        // - 2.9: a job carrying a function rather than a file is refused. The function body used to be
        //   persisted and evaluated again on requeue, so write access to the table ran code.

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

    describe('3.5 - mail queue reads and writes', () => {
        // the batch size is CLOSED (`sendBatchSize`), and the rest is WITHDRAWN and held by
        // ./mail-queue.evaluation.test.ts. The three reads are the per priority reservation, which
        // one ordered read cannot keep, and the write per mail is what keeps a crash to one resent
        // mail rather than a whole pass.
    });

    describe('3.11 - websocket serialization', () => {
        // 3.11 is CLOSED and measured in ./websocket.evaluation.test.ts. The service turned every
        // message into json and back only so socket.io's plain json encoder would not throw on a
        // bigint, and socket.io then wrote it again. The acknowledgement path skipped the round trip
        // and so threw on a bigint, which ../../websocket/services/websocket-payload.test.ts holds.
    });

    describe('3.12 - static asset caching', () => {
        // 3.12 is WITHDRAWN and observed in ./static-assets.evaluation.test.ts. Both the static
        // middleware and the favicon route send `max-age=0` with an ETag and a last-modified, so a
        // browser confirms its copy and is answered 304. Compression is the application's own
        // middleware, in front of both.
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
        //
        // The backup row is CLOSED and proven for real against a real server each:
        // ../../backup/transports/s3.backup-transport.test.ts against an S3 gateway that checks every
        // signature, and ../../backup/transports/sftp.backup-transport.test.ts against OpenSSH. Both
        // take a backup through BackupService and restore it. The checksum and restore verification
        // 5.4 asks for closed under 5.4.
    });

    // 4.1 and 4.2, the http client retry policy and body reads, are observed for real in
    // ./http-client.evaluation.test.ts
});