// Every name of the public entry points in one module: `zibri` and each `zibri/plugin/<name>`, for a test that reads
// the whole public api through one namespace. The plugins first: a name `zibri` keeps of a plugin until the next major
// is the same symbol on both, and is passed on as the plugin exports it rather than as its deprecated forward.
export * from '../plugin/analytics';
export * from '../plugin/approval';
export * from '../plugin/bank';
export * from '../plugin/bookkeeping';
export * from '../plugin/invoicing';
export * from '../plugin/mailing-list';
export * from '../plugin/mcp';
export * from '../plugin/payment';
export * from '../plugin/projects';
export * from '../index';