import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnectorClient } from '../src/connector/client';
import { DirectoryAssets } from '../src/repositories/assets/filesystem';
import { oauthConnector } from './connector-fixture';
import { alpha, beta } from './support';

const size = 18_874_373; // 18 MiB plus an uneven base64 tail; JSON exceeds the old 20 MiB cap.
const chunkBytes = 98_301; // Divisible by three: each chunk encodes independently.
const byte = 65;
const download = {
  id: 'gmail.download_attachment',
  input: { messageId: 'm1', attachmentId: 'a1' },
};

test('published Gmail files stream through the owned transport into asset storage and clean up', async () => {
  let bytes = size;
  let malformed = false;
  const fixture = await oauthConnector({
    service: 'gmail',
    respond(request) {
      const url = new URL(request.url);
      if (url.hostname === 'oauth2.googleapis.com') {
        return Response.json({
          access_token: 'private-file-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      expect(request.headers.get('authorization')).toBe('Bearer private-file-token');
      if (url.pathname.endsWith('/profile')) {
        return Response.json({ emailAddress: 'files@example.com' });
      }
      expect(url.pathname).toBe('/gmail/v1/users/me/messages/m1/attachments/a1');
      let remaining = bytes;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from('{"data":"'));
          },
          pull(controller) {
            if (remaining) {
              const length = Math.min(remaining, chunkBytes);
              controller.enqueue(Buffer.from(Buffer.alloc(length, byte).toString('base64url')));
              remaining -= length;
            } else {
              controller.enqueue(Buffer.from(`","size":${bytes + Number(malformed)}}`));
              controller.close();
            }
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const abort = new AbortController();
  const requirements = { service: 'gmail', actions: [download.id] };
  try {
    await expect(
      fixture.client.bind({
        ...beta,
        connection: fixture.connection,
        requirements,
        signal: abort.signal,
      }),
    ).rejects.toThrow('not found');
    const provider = await fixture.client.bind({
      ...alpha,
      connection: fixture.connection,
      requirements,
      signal: abort.signal,
    });
    await expect(provider.download!({ ...download, id: 'gmail.get_profile' })).rejects.toThrow(
      'operation denied',
    );
    const directory = join(fixture.files.dir, 'assets');
    const files = new DirectoryAssets(directory);
    const body = await provider.download!(download);
    // Connector has staged a transit file, but Open Sync has not consumed/buffered it.
    const transit = join(fixture.files.dir, 'connector', 'files');
    expect((await readdir(transit)).length).toBeGreaterThan(0);
    const captured = await files.write({ body, maxBytes: size, signal: abort.signal });
    const hash = createHash('sha256');
    for (let remaining = size; remaining > 0; ) {
      const length = Math.min(remaining, chunkBytes);
      hash.update(Buffer.alloc(length, byte));
      remaining -= length;
    }
    expect(captured).toMatchObject({ size, sha256: hash.digest('hex') });
    expect(await readdir(transit)).toEqual([]);
    await files.remove(captured.id);

    bytes = chunkBytes;
    await expect(
      files.write({ body: await provider.download!(download), maxBytes: 1, signal: abort.signal }),
    ).rejects.toMatchObject({ code: 'asset_too_large' });
    expect(await readdir(directory)).toEqual([]);
    expect(await readdir(transit)).toEqual([]);

    const cancelled = await provider.download!(download);
    await cancelled.cancel();
    expect(await readdir(transit)).toEqual([]);

    malformed = true;
    await expect(provider.download!(download)).rejects.toMatchObject({
      code: 'connector_request_failed',
    });
    expect(await readdir(transit)).toEqual([]);
    malformed = false;

    const pending = await provider.download!(download);
    abort.abort('paused');
    await expect(new Response(pending).arrayBuffer()).rejects.toBe('paused');
    // Abort starts cleanup even when nobody ever reads the returned stream.
    const timeoutMs = 2000;
    const deadline = Date.now() + timeoutMs;
    while ((await readdir(transit)).length && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    expect(await readdir(transit)).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('file downloads never follow action-supplied URLs or accept invalid file references', async () => {
  const fileId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const unavailable = 503;
  const ok = 200;
  let returnedId = fileId;
  const urls: string[] = [];
  let failure = false;
  const client = createConnectorClient({
    baseUrl: 'http://connector/prefix',
    adminToken: 'admin',
    runtimeToken: 'runtime',
    authorizeConnection: () => Promise.resolve(true),
    fetch(request) {
      urls.push(request.url);
      if (request.url.includes('/api/files/')) {
        expect(request.url).toBe(`http://connector/prefix/api/files/${fileId}`);
        return Promise.resolve(
          request.method === 'DELETE'
            ? Response.json({ deleted: true })
            : new Response('file', { status: failure ? unavailable : ok }),
        );
      }
      const data = request.url.includes('/by-id/')
        ? { id: 'c', service: 'gmail', alias: 'alice', status: 'active' }
        : request.method === 'GET'
          ? { service: 'gmail' }
          : { fileId: returnedId, downloadUrl: 'https://attacker.test/collect' };
      return Promise.resolve(Response.json({ success: true, data }));
    },
  });
  const provider = await client.bind({
    ...alpha,
    connection: { id: 'c', service: 'gmail' },
    requirements: { service: 'gmail', actions: [download.id] },
    signal: new AbortController().signal,
  });
  expect(await new Response(await provider.download!(download)).text()).toBe('file');
  failure = true;
  await expect(provider.download!(download)).rejects.toMatchObject({ status: 503 });
  for (const id of ['../secret', 'x?token=secret', 'https://attacker.test']) {
    returnedId = id;
    await expect(provider.download!(download)).rejects.toMatchObject({
      code: 'connector_request_failed',
    });
  }
  expect(urls.some((url) => url.includes('attacker.test'))).toBe(false);
});
