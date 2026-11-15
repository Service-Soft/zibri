import { pipeline, Readable, Transform } from 'node:stream';

import { MeasuredTransportConfig, TransportMeasurement } from './backup-measurement.model';
import { resolveBackupMeasurementConfig } from './resolve-backup-measurement-config.function';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { BackupTransportSessionInterface } from '../../../backup/transports/backup-transport-session.interface';
import { BackupTransportInterface, BackupTransportSupporting } from '../../../backup/transports/backup-transport.interface';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { S3BackupTransport } from '../../../backup/transports/s3.backup-transport';
import { SftpBackupTransport } from '../../../backup/transports/sftp.backup-transport';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { BackupTransportSessionTestUtilities } from '../../backup/backup-transport-session-test.utilities';

/**
 * Builds the transport the config names.
 * @param config - Where the backups are stored.
 * @returns The transport.
 */
function createTransport(config: MeasuredTransportConfig): BackupTransportSupporting<'v2'> {
    switch (config.kind) {
        case 'fs': {
            return new FsBackupTransport('measured-fs-backup-transport', FsUtilities.getPath(config.path));
        }
        case 's3': {
            return new S3BackupTransport('measured-s3-backup-transport', config.options);
        }
        case 'sftp': {
            return new SftpBackupTransport('measured-sftp-backup-transport', config.options);
        }
    }
}

/**
 * Counts the bytes that pass through.
 *
 * A transform rather than a listener on the data: listening puts a stream into flowing mode, and what
 * flows before the transport pipes it on is lost. Joined by a pipeline, so that a stream failing on
 * either side fails the other as well.
 * @param data - The stream to count.
 * @param counted - Called with the size of each chunk.
 * @param ended - Called once the last chunk passed through, if anything is waiting for that.
 * @returns The stream to read instead.
 */
function countBytes(data: Readable, counted: (bytes: number) => void, ended?: () => void): Readable {
    // the callbacks are the signature Transform calls its methods with
    /* eslint-disable promise/prefer-await-to-callbacks */
    const counter: Transform = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
            counted(chunk.length);
            callback(undefined, chunk);
        },
        flush: callback => {
            ended?.();
            callback();
        }
    });
    /* eslint-enable promise/prefer-await-to-callbacks */
    // the error reaches whoever reads the counter, which the pipeline destroys with it
    return pipeline(data, counter, () => undefined);
}

/**
 * The transport a measurement stores into, counting what it is asked to do, for the backup
 * measurements: the sessions it opens, and on them each `put`, the one of a record counted as
 * `putRecord`, each `get`, `findKeys` and `delete`.
 *
 * A real transport underneath, the one the config names, so that what is measured writes and reads
 * the way a deployment's transport does.
 */
@BackupTransport()
export class MeasuredBackupTransport implements BackupTransportInterface<'v2'> {
    readonly name: string = 'measured-backup-transport';

    readonly versions: readonly 'v2'[] = ['v2'];

    private readonly transport: BackupTransportSupporting<'v2'> = createTransport(resolveBackupMeasurementConfig().transport);

    private measurement: TransportMeasurement = MeasuredBackupTransport.createMeasurement();

    /**
     * Hands over what was counted since the last call, and starts counting anew.
     * @returns What was counted.
     */
    takeMeasurement(): TransportMeasurement {
        const taken: TransportMeasurement = this.measurement;
        this.measurement = MeasuredBackupTransport.createMeasurement();
        return taken;
    }

    async openSession(): Promise<BackupTransportSessionInterface> {
        // into the measurement the session began in, as the calls on it are
        const measurement: TransportMeasurement = this.measurement;
        const count: (method: string) => () => void = method => MeasuredBackupTransport.count(measurement, method);
        count('openSession')();
        return BackupTransportSessionTestUtilities.intercept(await this.transport.openSession(), {
            put: async (key, data, put) => {
                const done: () => void = count(BackupTransportSessionTestUtilities.isRecordKey(key) ? 'putRecord' : 'put');
                try {
                    await put(key, countBytes(data, bytes => measurement.bytesWritten += bytes));
                }
                finally {
                    done();
                }
            },
            get: async (key, maxBytes, get) => {
                // until the stream is read to its end, which is what fetching the data takes
                const done: () => void = count('get');
                return countBytes(await get(key, maxBytes), bytes => measurement.bytesRead += bytes, done);
            }
        });
    }

    /**
     * Counts a call, and starts timing it.
     * @param measurement - The measurement the call began in.
     * @param method - The method called.
     * @returns What ends the timing, adding it to the measurement.
     */
    private static count(measurement: TransportMeasurement, method: string): () => void {
        measurement.calls[method] = (measurement.calls[method] ?? 0) + 1;
        const startedAt: number = performance.now();
        return () => {
            measurement.callDurationsMs[method] = (measurement.callDurationsMs[method] ?? 0) + performance.now() - startedAt;
        };
    }

    private static createMeasurement(): TransportMeasurement {
        return { calls: {}, callDurationsMs: {}, bytesWritten: 0, bytesRead: 0 };
    }
}