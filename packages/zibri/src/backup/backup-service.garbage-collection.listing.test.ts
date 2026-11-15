import { describeBackupGarbageCollection } from './backup-service.garbage-collection.cases';

// an application that declares no BackupChunkEntity: each backup lists the chunks its transports hold
describeBackupGarbageCollection('BackupService - collecting garbage, with the chunks listed', false, 'backups-garbage-collection-listing');