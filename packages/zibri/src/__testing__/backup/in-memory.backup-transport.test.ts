import { InMemoryBackupTransport } from './in-memory.backup-transport';
import { describeBackupTransport } from '../../backup/transports/backup-transport.cases';

// what the tests built on it rely on: that it answers as the transports of a deployment do
describeBackupTransport('InMemoryBackupTransport', () => new InMemoryBackupTransport('in-memory-backup-transport'));