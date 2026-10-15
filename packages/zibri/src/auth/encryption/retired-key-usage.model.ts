/**
 * What is still encrypted under the keys and strategies being retired.
 *
 * A data key whose counts are both 0 encrypts none of the values the current models declare, and no
 * recorded backup needs it. An old master key or master strategy whose counts are both 0 is needed by
 * no data key and no recorded backup.
 */
export type RetiredKeyUsage = {
    /**
     * Every data key that is deprecated or belongs to a deprecated strategy.
     */
    dataKeys: RetiredDataKeyUsage[],
    /**
     * Every key in `oldMasterKeys`.
     */
    masterKeys: RetiredMasterKeyUsage[],
    /**
     * Every strategy in `oldMasterStrategies`.
     */
    masterStrategies: RetiredMasterStrategyUsage[]
};

/**
 * A deprecated data key, and how much is still encrypted with it.
 */
export type RetiredDataKeyUsage = {
    /**
     * The id of the key.
     */
    keyId: string,
    /**
     * The name of the strategy the key belongs to.
     */
    strategyName: string,
    /**
     * The version of the strategy the key belongs to.
     */
    strategyVersion: string,
    /**
     * How many values stored in the data sources are encrypted with it.
     */
    values: number,
    /**
     * How many recorded backups need it to still exist when they are restored: those taken while it
     * existed that do not hold the data keys themselves.
     */
    backups: number
};

/**
 * What is still encrypted under an old master key or strategy.
 */
export type RetiredMasterUsage = {
    /**
     * How many data keys are encrypted under it.
     */
    dataKeys: number,
    /**
     * How many recorded backups need it to be restored.
     */
    backups: number
};

/**
 * An old master key, and what is still encrypted under it.
 */
export type RetiredMasterKeyUsage = RetiredMasterUsage & {
    /**
     * The id of the master key.
     */
    keyId: string
};

/**
 * An old master strategy, and what is still encrypted with it.
 */
export type RetiredMasterStrategyUsage = RetiredMasterUsage & {
    /**
     * The name of the strategy.
     */
    name: string,
    /**
     * The version of the strategy.
     */
    version: string
};