// Retired: never read, log, persist, or forward submitted personal information.
export const onRequest: PagesFunction = async () => new Response(JSON.stringify({
  error: 'Trial suggestions are no longer collected. Please use the trial search.',
}), {
  status: 410,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
})
