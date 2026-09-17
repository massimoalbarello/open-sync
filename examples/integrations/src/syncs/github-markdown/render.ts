// Adapted for Open Sync from massimoalbarello/open-connector.
import type { SyncRecord } from '@open-sync/core/delivery';
import { z } from 'zod';
import { markdownRecord, type Participant as SyncParticipant } from '../../formats/markdown';

const actorSchema = z
  .object({ login: z.string(), url: z.string(), id: z.string().optional() })
  .nullable();
const date = z.iso.datetime({ offset: true });
const pullResponse = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  url: z.url(),
  createdAt: date,
  updatedAt: date,
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  mergedAt: date.nullable(),
  closedAt: date.nullable(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  repository: z.object({ id: z.string(), nameWithOwner: z.string(), url: z.url() }),
  author: actorSchema,
});
const commentResponse = z.object({
  id: z.string(),
  body: z.string(),
  url: z.url(),
  createdAt: date,
  updatedAt: date,
  author: actorSchema,
});
const reviewResponse = z.object({
  id: z.string(),
  body: z.string(),
  url: z.url(),
  submittedAt: date.nullable(),
  state: z.string(),
  author: actorSchema,
});
const threadResponse = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number().int().nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  comments: z.array(commentResponse),
});

interface PullRequestContent {
  pull: Record<string, unknown>;
  comments: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  threads: Record<string, unknown>[];
}

function collectParticipants() {
  const participants = new Map<string, SyncParticipant>();
  const actor = (input: { person: z.infer<typeof actorSchema>; role: string }): string => {
    const { person, role } = input;
    if (!person) {
      return 'Deleted user';
    }
    const id = person.id;
    const name = person.login;
    if (id) {
      const current = participants.get(id) ?? {
        identities: [{ namespace: 'github', id }],
        roles: [],
        name,
      };
      current.roles = [...new Set([...current.roles, role])].sort();
      participants.set(id, current);
    }
    return name;
  };
  return { participants, actor };
}

/** Deterministic complete replacement, preserving upstream Markdown and stable native IDs. */
export function renderPullRequest(input: PullRequestContent): SyncRecord {
  const pull = pullResponse.parse(input.pull);
  const comments = input.comments.map((item) => commentResponse.parse(item));
  const reviews = input.reviews.map((item) => reviewResponse.parse(item));
  const threads = input.threads
    .map((item) => threadResponse.parse(item))
    .filter((thread) => thread.comments.length > 0);
  const repository = pull.repository;
  const { participants, actor } = collectParticipants();
  const title = `${repository.nameWithOwner} #${pull.number}: ${pull.title}`;
  const lines = [
    `# ${title}`,
    pull.url,
    `State: ${pull.state}${pull.isDraft ? ' (draft)' : ''}`,
    `Author: ${actor({ person: pull.author, role: 'author' })}`,
    `Branch: ${pull.headRefName} → ${pull.baseRefName}`,
    `Created: ${pull.createdAt} | Updated: ${pull.updatedAt}`,
    `Merged: ${pull.mergedAt || 'No'} | Closed: ${pull.closedAt || 'No'}`,
    '## Description',
    quoteMarkdown(pull.body),
  ];
  if (comments.length) {
    lines.push('## Comments');
  }
  for (const comment of sort({ items: comments, key: (item) => `${item.createdAt}\0${item.id}` })) {
    lines.push(
      `### ${actor({ person: comment.author, role: 'commenter' })} — ${comment.createdAt}`,
      `Updated: ${comment.updatedAt} | ${comment.url}`,
      quoteMarkdown(comment.body),
    );
  }
  if (reviews.length) {
    lines.push('## Reviews');
  }
  for (const review of sort({
    items: reviews,
    key: (item) => `${item.submittedAt ?? ''}\0${item.id}`,
  })) {
    lines.push(
      `### ${actor({ person: review.author, role: 'reviewer' })} — ${review.state}`,
      `${review.submittedAt ?? 'Pending'} | ${review.url}`,
      quoteMarkdown(review.body),
    );
  }
  if (threads.length) {
    lines.push('## Review discussions');
  }
  for (const thread of sort({ items: threads, key: (thread) => thread.id })) {
    lines.push(threadHeading(thread));
    for (const comment of sort({
      items: thread.comments,
      key: (item) => `${item.createdAt}\0${item.id}`,
    })) {
      lines.push(
        `#### ${actor({ person: comment.author, role: 'reviewer' })} — ${comment.createdAt}`,
        `Updated: ${comment.updatedAt} | ${comment.url}`,
        quoteMarkdown(comment.body),
      );
    }
  }
  const data = markdownRecord.parse({
    title,
    body: lines.join('\n\n'),
    sourceUrl: pull.url,
    sourceCreatedAt: pull.createdAt,
    sourceUpdatedAt: pull.updatedAt,
    participants: [...participants.values()],
    attributes: {
      repository: repository.nameWithOwner,
      number: pull.number,
      state: pull.state,
      draft: pull.isDraft === true,
    },
  });
  return { operation: 'upsert', kind: 'pull-request', id: pull.id, data };
}

function sort<T>(input: { items: T[]; key: (item: T) => string }): T[] {
  const { items, key } = input;
  // biome-ignore lint/complexity/useMaxParams: Array.sort requires a two-value comparator.
  return [...items].sort((a, b) => {
    const left = key(a),
      right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Keep authored headings and fenced code inside their own Markdown container. */
function quoteMarkdown(value: string): string {
  return value
    .split(/\r\n|\r|\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function threadHeading(thread: z.infer<typeof threadResponse>): string {
  return `### ${thread.path}:${thread.line ?? ''} (${thread.isResolved ? 'resolved' : 'unresolved'}${thread.isOutdated ? ', outdated' : ''})`;
}
