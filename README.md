# Grounded /api/chat Trial Submission

This repo is a clean submission package for the paid trial task: a strictly grounded listings assistant built with Next.js 16, React 19, TypeScript strict mode, and the Vercel AI SDK.

The assistant recommends from one local JSON dataset only. It does not answer from open-web knowledge, it restricts model access to typed tools, it streams over HTTP, and it returns structured listing references for safe card rendering.

## Scope

Included:

- `POST /api/chat` built with the Vercel AI SDK
- typed `searchListings` and `getListingById` tools
- strict dataset-only grounding
- refusal handling for prompt injection and out-of-scope requests
- structured listing references for frontend cards
- server-side validation of IDs and URLs
- evals and reviewer prompt pack

Removed from this submission copy:

- experimental widget demo route
- extra handoff/publishing notes from the working sandbox
- non-essential demo surfaces outside the paid trial scope

## Stack

- Next.js 16 App Router
- React 19
- TypeScript strict mode
- Vercel AI SDK `streamText`
- `useChat` on the client
- OpenAI-compatible or Anthropic provider setup
- Vitest eval suite

## What the route returns

The app streams:

- assistant text
- `data-notice`
- `data-status`
- `data-listingReferences`
- `data-audit`

The cards in the UI are rendered from validated `data-listingReferences`, not model-invented JSON.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file:

```bash
cp .env.example .env.local
```

3. Add one provider configuration.

OpenRouter example:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=YOUR_OPENROUTER_KEY
OPENAI_MODEL=openai/gpt-oss-120b:free
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_SITE_URL=http://localhost:3000
OPENAI_APP_NAME=Grounded Chat Trial
```

Anthropic example:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_KEY
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

4. Start dev server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

If port `3000` is busy, Next.js will move to another port such as `3001`.

## Validation and tests

Run:

```bash
npm run lint
npm run build
npm run test:evals
npm run test:reviewer-pack
```

`test:reviewer-pack` posts a manual-review prompt pack to the live local app so the trial prompts can be replayed quickly.

## Vercel deployment

This repo should deploy directly to Vercel as long as the environment variables are added in the Vercel project settings.

Required:

- `AI_PROVIDER`
- provider API key
- provider model name
- `OPENAI_BASE_URL` when using OpenRouter
- optional OpenRouter metadata fields like `OPENAI_SITE_URL` and `OPENAI_APP_NAME`

After that, Vercel should be able to run:

```bash
npm install
npm run build
```

without extra infrastructure changes.

## Reviewer files

- [evals/trial.spec.ts](./evals/trial.spec.ts)
- [evals/chat-contract.spec.ts](./evals/chat-contract.spec.ts)
- [evals/REVIEWER_CHECKLIST.md](./evals/REVIEWER_CHECKLIST.md)
- [evals/reviewer-prompt-pack.json](./evals/reviewer-prompt-pack.json)
