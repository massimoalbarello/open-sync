import { expect, test } from 'bun:test';
import { granolaMeetings } from '../src/syncs/granola/definition';
import { fixture, owner, unused } from './fixture';

const meetingCount = 23;
const finalChunkSize = 3;
const pollCount = 3;
const ids = [...Array(meetingCount).keys()].map((id) => String(id).padStart(2, '0'));
const meeting = (id: string) => ({
  id,
  title: `Meeting ${id}`,
  summary: '## Decisions\nShip it.',
  date: '2026-09-19',
  attendees: 'Alice, Sam',
});

test('Granola completes one unpaginated listing in one step and preserves notes absent from later listings', async () => {
  let visible = ids;
  let listings = 0;
  const requested: string[][] = [];
  const f = await fixture({
    registration: granolaMeetings,
    provider: {
      get: unused,
      post: unused,
      action: ({ id, input }) => {
        if (id === 'granola.list_meetings') {
          listings++;
          return Promise.resolve({ meetings: visible.map(meeting) });
        }
        const batch = input.meeting_ids as string[];
        requested.push(batch);
        return Promise.resolve({ meetings: batch.map(meeting) });
      },
    },
  });
  try {
    await f.engine.tick();
    expect(f.saved).toMatchObject({ status: 'succeeded', checkpoint: {} });
    expect(listings).toBe(1);
    expect(requested.map((batch) => batch.length)).toEqual([10, 10, finalChunkSize]);
    expect(requested.flat()).toEqual(ids);
    await f.restart();
    await f.finish();
    expect(listings).toBe(1);
    expect(f.records.map((record) => record.id)).toEqual(ids);
    expect(f.records[0]).toMatchObject({
      kind: 'meeting',
      preview: 'Meeting 00',
      data: {
        title: 'Meeting 00',
        notes: '## Decisions\nShip it.',
        date: '2026-09-19',
        attendees: 'Alice, Sam',
      },
    });
    expect(f.records[0]).not.toHaveProperty('createdAt');
    expect(f.records[0]).not.toHaveProperty('updatedAt');
    expect(f.records[0]).not.toHaveProperty('occurredAt');
    visible = [...ids].reverse();
    f.queue();
    await f.finish();
    expect(listings).toBe(2);
    expect(f.records).toHaveLength(meetingCount);
    visible = [];
    f.queue();
    await f.finish();
    expect(listings).toBe(pollCount);
    expect(f.records).toHaveLength(meetingCount);
    expect(f.saved).toMatchObject({ status: 'succeeded', checkpoint: {} });
  } finally {
    await f.close();
  }
});

test.each(['transient', 'missing', 'duplicate', 'foreign'] as const)(
  'Granola commits no partial listing after a %s detail failure and retries the whole step after restart',
  async (mode) => {
    let fail = true;
    let listings = 0;
    const requested: string[][] = [];
    const f = await fixture({
      registration: granolaMeetings,
      provider: {
        get: unused,
        post: unused,
        action: ({ id, input }) => {
          if (id === 'granola.list_meetings') {
            listings++;
            return Promise.resolve({ meetings: [...ids].reverse().map(meeting) });
          }
          const batch = input.meeting_ids as string[];
          requested.push(batch);
          let meetings = batch.map(meeting);
          if (fail && batch.includes('10')) {
            if (mode === 'transient') {
              throw new Error('Detail request failed');
            }
            meetings =
              mode === 'missing'
                ? meetings.slice(1)
                : mode === 'duplicate'
                  ? [...meetings, meetings[0]!]
                  : [...meetings.slice(1), meeting('unexpected')];
          }
          return Promise.resolve({ meetings });
        },
      },
    });
    try {
      await f.engine.tick();
      expect(requested.map((batch) => batch.length)).toEqual([10, 10]);
      expect(f.saved).toMatchObject({
        status: 'retrying',
        errorCode: 'execution_failed',
        checkpoint: {},
      });
      expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
      expect(f.records).toHaveLength(0);
      await f.restart();
      fail = false;
      f.queue();
      await f.finish();
      expect(listings).toBe(2);
      expect(requested.slice(2).flat()).toEqual(ids);
      expect(f.saved).toMatchObject({ status: 'succeeded', checkpoint: {} });
      expect(f.records.map((record) => record.id)).toEqual(ids);
      expect(f.deliveries).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);
