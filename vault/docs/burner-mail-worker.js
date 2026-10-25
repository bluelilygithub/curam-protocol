// Cloudflare Email Worker for Burner Mail (see docs/burner-mail.md). Paste into a Worker, then set the variables VAULT_URL and SECRET.
// Cloudflare Email Routing catch-all -> "Send to a Worker" -> this file. It passes each raw email on to Vault and does nothing else.
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const res = await fetch(env.VAULT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'message/rfc822',
        'x-inbound-secret': env.SECRET,
        'x-envelope-to': message.to,
      },
      body: raw,
    });
    if (!res.ok) throw new Error(`Vault answered ${res.status}`); // Cloudflare then reports the failure in its logs
  },
};
