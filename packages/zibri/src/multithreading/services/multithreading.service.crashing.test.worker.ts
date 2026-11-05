// Fixture: kills the whole worker thread outright, instead of throwing/rejecting inside it. This hits
// MultithreadingService.handleWorkerExit (not handleWorkerMessage's 'error' case) and should trigger
// freeWorker()'s crash-recovery path, which spins up a replacement worker via initWorker().
process.exit(1);