# Postmortem Assistant

A small AI-powered app on Cloudflare that turns raw incident notes into a blameless postmortem draft. Paste the timeline from your incident channel, and it extracts a structured timeline, writes the clarifying questions a good postmortem needs, drafts the document (summary, impact, timeline, root cause, contributing factors) and proposes action items. You then answer the questions or ask for changes in the chat, and it revises the draft with the answers.

Built for the optional assignment in Cloudflare's Senior Systems Engineer, Developer Tooling application.

## Built with AI assistance

This project was built with Claude Code (Anthropic's coding agent) doing the programming. I'm a cloud infrastructure engineer. My day job is GCP, GKE, Terraform, Kubernetes operations, CI/CD and incident response, not application development, and I don't want this repo to suggest otherwise. I chose the problem (postmortems are something I write for real), set the constraints, reviewed what came back, and ran the deploy and the end-to-end check. Every prompt that went into building it is in [PROMPTS.md](PROMPTS.md), verbatim and in order, including the prompts the app sends to the model at runtime.

## How the four required components are satisfied

| Requirement | What this app uses | Where in the code |
| --- | --- | --- |
| LLM | Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), JSON mode for one structured step and a prompted JSON contract for the other two | `src/ai.ts`, `src/prompts.ts` |
| Workflow or coordination | A Cloudflare Workflow with five durable steps, each retried on failure | `src/workflow.ts` |
| User input via chat | A chat page served as static assets from the same Worker (the Workers replacement for a Pages site) | `public/index.html`, `src/index.ts` |
| Memory or state | A Durable Object per incident, SQLite-backed, holding the notes, every artifact and the whole conversation | `src/incident.ts` |

## Architecture

```
browser (public/index.html)
   |  POST /api/incidents            {timeline}
   |  GET  /api/incidents/:id        snapshot + workflow status (polled)
   |  POST /api/incidents/:id/chat   {message}
   v
Worker router (src/index.ts)
   |-- creates IncidentState DO named by incident id   (src/incident.ts, SQLite)
   |-- starts PostmortemWorkflow with that id          (src/workflow.ts)
   '-- chat: DO builds context from its own state and calls Workers AI

PostmortemWorkflow steps, each reading from and writing to the DO:
   1. load incident notes
   2. extract timeline            -> Workers AI, prompted JSON
   3. generate clarifying questions -> Workers AI, JSON mode
   4. draft postmortem            -> Workers AI, Markdown
   5. propose action items        -> Workers AI, prompted JSON
```

The Durable Object is the single source of truth. The Workflow never keeps state of its own beyond what each step returns; it writes every artifact into the Durable Object and advances a `stage` field, so the page can poll one endpoint and show progress as each step lands. The chat handler lives on the Durable Object too, so follow-up questions always see the raw notes, every artifact and the last 20 messages.

A few deliberate choices:

- The Workflow instance id is the incident id, so the status endpoint can report both the app's stage and the Workflow's own status.
- Each AI step saves its result inside the step. A retry overwrites rather than duplicates, so steps are safe to re-run.
- The clarifying-questions step uses Workers AI JSON mode with a schema. The timeline and action-item steps put the same JSON Schema in the prompt and parse the reply instead, then normalise the fields in code. The reason is below. The draft step asks for Markdown because the page renders it directly.
- The front end is one HTML file with no build step. It keeps the incident id in the URL hash and a short recent list in `localStorage`, so reloading or sharing the link reopens the same conversation from the Durable Object.
- No secrets. Workers AI is reached through the `AI` binding.

## Running it

Prerequisites: Node 20 or newer and a Cloudflare account on the free plan. Workers, Workers AI, Durable Objects with SQLite storage, Workflows and static assets are all available at no charge, with daily limits.

```bash
npm install
npx wrangler login
npm run dev
```

Open http://localhost:8787, click "Load an example" and then "Start postmortem". Workers AI calls go to Cloudflare even in local development, which is why `wrangler login` is needed before `npm run dev`.

Deploy:

```bash
npm run deploy
```

Wrangler creates the Durable Object class, the Workflow and the asset bucket on first deploy and prints the `*.workers.dev` URL.

Typecheck:

```bash
npm run check
```

## A finding from the end-to-end check

The first deployed run came back with an empty timeline and no action items while the questions and the draft were fine. Probing Workers AI directly showed the cause: with `response_format: { type: "json_schema" }` and a schema whose property is an array of objects, Llama 3.3 on Workers AI returns `{"events": []}` after 7 completion tokens, with or without enums in the schema. The same messages without JSON mode return the full list. A flat array of strings works in JSON mode. So the two nested steps describe the schema in the prompt and parse the reply, and the code normalises kinds, priorities and missing fields rather than trusting the model to follow the schema exactly. Each of those steps also throws when the list comes back empty, so the Workflow retries instead of saving nothing.

## Limits worth knowing

- Workers AI on the free plan gives 10,000 neurons a day. One full run of the four AI steps on the example incident uses roughly 1,000 to 1,500 neurons, so expect around 6 to 9 complete postmortems a day before calls start failing until the daily reset at 00:00 UTC.
- Llama 3.3 on Workers AI has a 24k-token context window. Notes are capped at 20,000 characters and chat messages at 4,000 characters to stay inside it.
- Workflow steps time out after 3 minutes and retry twice. If every retry fails, the incident is marked `failed` with the error in the chat, and the Workflow instance is marked errored.
- Everything is on the free plan. Nothing in this repo costs money to run at this scale.

## Repository layout

```
public/index.html   chat page (static asset)
src/index.ts        Worker entry: routes, starts the Workflow, serves assets
src/incident.ts     IncidentState Durable Object (SQLite): notes, artifacts, chat history, chat handler
src/workflow.ts     PostmortemWorkflow: the five steps and the JSON schemas
src/ai.ts           thin wrapper over env.AI.run for text and JSON mode
src/prompts.ts      every runtime prompt sent to the model
wrangler.jsonc      bindings: AI, Durable Object, Workflow, assets
PROMPTS.md          every prompt used to build this, verbatim
```
