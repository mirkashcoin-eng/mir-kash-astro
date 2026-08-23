// Whereby Embedded — rooms for Private Viewing video appointments.
//
// Rooms are created server-side so the API key never reaches the browser. Whereby
// returns two URLs per meeting: roomUrl for the customer, and hostRoomUrl (carrying
// a roomKey) which grants host controls — only ever send that one to the team.

const API = 'https://api.whereby.dev/v1/meetings';

export interface Meeting {
  meetingId: string;
  roomUrl: string;
  hostRoomUrl: string;
  startDate: string;
  endDate: string;
}

function apiKey(): string {
  return (
    (typeof process !== 'undefined' ? process.env.WHEREBY_API_KEY : undefined) ||
    (import.meta.env.WHEREBY_API_KEY as string | undefined) ||
    ''
  );
}

export function wherebyConfigured(): boolean {
  return Boolean(apiKey());
}

/**
 * Creates a meeting room. `endDate` is when Whereby expires the room — pass the
 * appointment end, with enough slack that an overrunning call isn't cut off.
 */
export async function createMeeting(opts: {
  endDate: Date;
  /** Shown in the room; keeps the team's meeting list readable. */
  roomNamePrefix?: string;
}): Promise<Meeting | null> {
  const key = apiKey();
  if (!key) {
    console.error('[whereby] WHEREBY_API_KEY is not set');
    return null;
  }

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endDate: opts.endDate.toISOString(),
        roomNamePrefix: opts.roomNamePrefix,
        // hostRoomUrl isn't returned unless asked for.
        fields: ['hostRoomUrl'],
      }),
    });

    if (!res.ok) {
      console.error('[whereby] createMeeting failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return {
      meetingId: String(data.meetingId),
      roomUrl: data.roomUrl,
      hostRoomUrl: data.hostRoomUrl,
      startDate: data.startDate,
      endDate: data.endDate,
    };
  } catch (err) {
    console.error('[whereby] createMeeting threw:', err);
    return null;
  }
}
