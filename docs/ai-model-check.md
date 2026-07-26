# ATLAS OpenAI integration

No credential value is recorded in this file.

## Provider boundary

- Provider: OpenAI
- Base URL: `https://api.openai.com/v1`
- Operation: `POST /chat/completions`
- Authentication: `Authorization: Bearer $OPENAI_API_KEY`
- Credential location: server-side environment only
- Browser route: `/api/chat`

The browser never receives the provider key, base URL, system prompt or raw provider errors.

## Models

Default order:

1. `gpt-4.1-mini`
2. `gpt-4.1-nano`

Every request uses the strict `atlas_terminal_action` JSON Schema. Every successful response is parsed and validated again server-side. Invalid output falls through to the next model; authentication, billing and insufficient-quota errors stop immediately.

## Transaction boundary

The model can only return a proposed action. It cannot sign or broadcast transactions. The browser validates the action, fetches bounded quotes where required, shows a separate confirmation and delegates signing to the connected wallet.

## Credential status

Any credential pasted into chat must be revoked and replaced. Install the replacement directly as `OPENAI_API_KEY` in the private local environment and Vercel project settings; never commit it or use a public-prefixed variable.
