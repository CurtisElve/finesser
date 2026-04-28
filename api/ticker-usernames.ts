const file = Bun.file(new URL('../data/ticker-usernames.json', import.meta.url));
const NAMES: string[] = (await file.json()) as string[];

export function tickerUsernames(): Response {
  const shuffled = [...NAMES].sort(() => Math.random() - 0.5);
  return Response.json(shuffled, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
