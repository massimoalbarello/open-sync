import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { gmailThreads } from '@open-sync/examples/syncs/gmail';
import { googleCalendarEvents } from '@open-sync/examples/syncs/googlecalendar';
import { granolaMeetings } from '@open-sync/examples/syncs/granola';
import { slackThreads } from '@open-sync/examples/syncs/slack';
import { youtubePlaylists } from '@open-sync/examples/syncs/youtube';

export const syncDefinitions = [
  githubPullRequests,
  gmailThreads,
  googleCalendarEvents,
  slackThreads,
  granolaMeetings,
  youtubePlaylists,
];
