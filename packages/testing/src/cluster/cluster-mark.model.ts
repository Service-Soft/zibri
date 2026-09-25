import { BaseEntity, Entity, Property } from 'zibri';

/**
 * A row an instance writes to record that it, specifically, did something.
 *
 * This is how a cluster test observes how work was distributed. The parent never asks an instance
 * what it did - it reads this straight out of the data source, so the answer does not travel
 * through any code path belonging to the thing under test.
 *
 * The framework's own tables cannot answer this: CronJobEntity has one row per job that every
 * replica overwrites, and Email has no column saying who sent it. Which instance did the work is
 * exactly the question, so a scenario owned table is the only place it can be recorded.
 *
 * The canonical assertion is "group by tag, every group has exactly one row": a cron tick, a queued
 * mail or a replayed event has to be picked up once by the cluster, not once per replica.
 */
// allowOrphan, because this is exported from the package's barrel: importing anything from
// `zibri-testing` registers it, and an application that runs no cluster test has no reason to carry
// the table. The shipped plugins declare their entities the same way, for the same reason.
@Entity({ allowOrphan: true })
export class ClusterMark extends BaseEntity {
    /**
     * The id of the instance that wrote this row.
     */
    @Property.string()
    instanceId!: string;

    /**
     * What happened, eg. 'cron' or 'mail-sent'. One scenario can record several kinds.
     */
    @Property.string()
    kind!: string;

    /**
     * Which occurrence of that kind this was, eg. The tick a cron job fired for or the id of the
     * mail that was sent. This is what a test groups by to find duplicated work.
     */
    @Property.string()
    tag!: string;

    /**
     * When the row was written.
     */
    @Property.date()
    at!: Date;
}

/**
 * A {@link ClusterMark} as it comes back out of a raw query.
 *
 * Column names are the property names verbatim - the framework does not snake case them, only
 * table names - so any sql selecting them has to quote them.
 */
export type ClusterMarkRow = {
    /**
     * The id of the instance that wrote this row.
     */
    instanceId: string,
    /**
     * What happened.
     */
    kind: string,
    /**
     * Which occurrence of that kind this was.
     */
    tag: string,
    /**
     * When the row was written, as the data source serialized it to json.
     */
    at: string
};