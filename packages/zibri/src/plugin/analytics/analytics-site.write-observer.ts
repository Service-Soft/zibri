import { EntityWriteObserver } from '../../data-source/write-observers/entity-write-observer.model';

/**
 * Has the analytics service forget the sites it keeps in memory whenever one is written, here at once and on every
 * other instance within seconds, however the site is written.
 */
export class AnalyticsSiteWriteObserver implements EntityWriteObserver {
    /**
     * None: every write has every site read again.
     */
    readonly properties: string[] = [];

    constructor(private readonly forget: () => Promise<void>) {}

    /**
     * Forgets the sites.
     */
    async handleWritten(): Promise<void> {
        await this.forget();
    }
}