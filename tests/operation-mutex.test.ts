import { describe, expect, it } from 'vitest';
import { OperationMutex } from '../src/operation-mutex';

describe('operation mutex', () => {
  it('serializes operations started concurrently', async () => {
    const mutex = new OperationMutex();
    const events: string[] = [];
    let release!: () => void;
    const first = mutex.run(async () => { events.push('first-start'); await new Promise<void>((resolve) => { release = resolve; }); events.push('first-end'); });
    const second = mutex.run(async () => { events.push('second'); });
    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });
});
