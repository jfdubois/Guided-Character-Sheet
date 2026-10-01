export class OperationMutex {
  private tail: Promise<void> = Promise.resolve();

  run(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
