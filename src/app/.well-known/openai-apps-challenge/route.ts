// Domain verification for the OpenAI plugin (ChatGPT / Codex) submission.
//
// The submission portal generates a token per plugin and then fetches
// `https://<mcp-host>/.well-known/openai-apps-challenge`, expecting the bare
// token as the whole response body — not JSON, not a list, not multiple tokens.
//
// Set OPENAI_APPS_CHALLENGE_TOKEN (a Worker secret) to the value the portal
// shows, redeploy, then press Verify. Until it is set this route 404s, which is
// the correct answer for "no plugin is being verified against this host".
export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token) return new Response("Not Found", { status: 404 });
  return new Response(token, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
