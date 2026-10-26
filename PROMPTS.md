# Prompts

Cloudflare's assignment asks for the prompt history when AI-assisted coding is used. This file holds every prompt, verbatim and in order.

The build happened in Claude Code (Anthropic's coding agent). Mileke pasted the assignment into one Claude Code session. That session (Claude) chose the idea, wrote the brief below and handed it to a second Claude Code session, which did the build. Part 1 is Mileke's own words, which are short. Part 2 is the brief the build session received, the first Claude-authored prompt. Part 3 lists every prompt the deployed app sends to Llama 3.3 at runtime.

## Part 1: what Mileke typed

Mileke typed exactly one message about the assignment, on 2026-10-26, to the Claude Code session that was helping with his job applications. It was the text of Cloudflare's form field, preceded by his own words "This is on cloudflare's form:". The pasted content, verbatim:

```
Optional Assignment: Please share GitHub repo URL for the project here
We plan to fast track candidates who complete an assignment to build a type of [AI-powered application](https://agents.cloudflare.com/) on Cloudflare. An AI-powered application should include the following components:

* LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice
* Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
* User input via chat or voice (recommend using Pages or Realtime)
* Memory or state

Find additional documentation [here](https://developers.cloudflare.com/agents/).
Note: AI-assisted coding is encouraged, but you have to submit prompt history.
```

He typed nothing else about it. Claude recommended the postmortem-assistant idea in its reply, then proposed the build as a separate session. Mileke started that session with a click, without adding text. Everything from here on was authored by Claude on his behalf.

## Part 2: the brief given to the build session (verbatim, written by Claude)

```
Background (from the session that started this one):
Mileke Kolawole (he/him, milekekolawole@gmail.com, personal GitHub account `mileke`) is applying to Cloudflare for Senior Systems Engineer, Developer Tooling. The application form has an optional assignment that fast-tracks candidates: build an AI-powered application on Cloudflare with four components, an LLM (Llama 3.3 on Workers AI recommended), workflow or coordination (Workflows, Workers or Durable Objects), user input via chat or voice (Pages or Realtime), and memory or state. AI-assisted coding is encouraged but the prompt history must be submitted. Docs: https://developers.cloudflare.com/agents/ and https://agents.cloudflare.com/.

Constraints that matter: Mileke is a cloud infrastructure engineer, not a confident application developer, and is honest about that; the README must say plainly that the project was built with AI assistance, and a PROMPTS.md must record every prompt used, including the ones given to this session, verbatim. Nothing in the project may claim skills he does not have. His real experience: GCP, GKE, Terraform, Kubernetes operations, CI/CD, Vault, Teleport, Prometheus and Grafana, incident postmortems at Moniepoint and Namiri Technologies. Personal repos live under `~/Documents/CodeFiles` and use his personal git identity via `~/.gitconfig-personal` (an includeIf rule for that folder); the gh CLI default is the work account `mileke0`, so run `gh auth switch -u mileke` before creating the repo and switch back afterwards. He does not want em dashes in anything written, and no Python, Go, AWS or Azure claims anywhere.

He must sign in to his Cloudflare account himself (never create accounts or enter credentials for him); `wrangler login` opens a browser for that. Use the free plan only: Workers, Workers AI, Durable Objects with SQLite storage, Workflows and Pages are all available on it. Nothing should cost money.

Task:
Build, deploy and document a small AI-powered application on Cloudflare for an optional job-application assignment, in a new private repo `mileke/postmortem-assistant` created at `~/Documents/CodeFiles/postmortem-assistant` (create that folder; do not work in the session's starting folder).

What to build: an incident postmortem assistant. The user pastes an incident timeline into a chat page. A Durable Object holds each incident's state and conversation (memory). A Cloudflare Workflow runs the steps: extract a structured timeline, generate the clarifying questions a good postmortem needs, draft the postmortem (summary, impact, timeline, root cause, contributing factors), propose action items. Llama 3.3 on Workers AI writes the prose. A Pages front end provides the chat. Keep the code small and readable in TypeScript, with a clear `README.md` explaining the architecture, how each of Cloudflare's four required components is satisfied, how to run it, and a candid note that it was built with AI assistance; keep `PROMPTS.md` with every prompt used verbatim and in order.

Steps: confirm `wrangler` is installed (`npm i -g wrangler` if not) and ask Mileke to run `wrangler login` in the terminal pane; scaffold with `npm create cloudflare@latest` using a Workers + Durable Objects template, add a Workflow binding and a Workers AI binding in `wrangler.toml`, build the Durable Object, the Workflow and the chat page, test locally with `wrangler dev`, deploy with `wrangler deploy` (and Pages for the front end if separate), and verify the deployed URL end to end with one real incident timeline. Commit with his personal identity, create the private repo with `gh repo create mileke/postmortem-assistant --private --source . --push` after `gh auth switch -u mileke`, then switch gh back to `mileke0`.

Done looks like: a working deployed URL; a repo with README.md and PROMPTS.md; a short note back listing the URL, the repo link, the four components and where each lives in the code, and anything he must do by hand (the Cloudflare login, pasting the repo URL into the form). Do not submit anything to Cloudflare's form yourself.
```

Notes on what the build session did with the brief: it used `wrangler.jsonc` (what `npm create cloudflare` generates today) rather than `wrangler.toml`, and served the chat page as Workers static assets from the same Worker instead of a separate Pages project, which is Cloudflare's current recommendation for new projects. Both are noted in the README.

## Part 3: runtime prompts the app sends to Llama 3.3

These live in `src/prompts.ts` and are reproduced here from that file. Every model call starts with the tone prompt as the system message, followed by the step instruction, with the incident notes (and earlier artifacts) as the user message.

### Tone (system message prefix for every call)

> You are an experienced site reliability engineer helping a colleague write a blameless incident postmortem. Work only from the facts in the incident notes. Never invent times, people, systems or causes. If something is unknown, say so. Use plain English and short sentences. Do not use em dashes.

### Step 2: extract timeline (JSON mode)

> Read the raw incident notes and extract an ordered timeline of events. Each event needs the time exactly as written in the notes (or 'unknown'), what happened, and who or what acted. Classify each event as one of: detection, escalation, investigation, mitigation, resolution, communication, other. Keep the original order. Do not add events that are not in the notes.

### Step 3: clarifying questions (JSON mode)

> A good postmortem answers questions the raw notes usually skip. Given the notes and the extracted timeline, write the 5 to 8 most useful clarifying questions for the incident responders. Favour questions about detection gaps, customer impact, why mitigation took as long as it did, what made the root cause possible, and what nearly went wrong. Each question must be specific to this incident, not generic.

### Step 4: draft postmortem (Markdown)

> Write a blameless postmortem draft in Markdown with exactly these second-level headings in this order: Summary, Impact, Timeline, Root cause, Contributing factors. Summary is three or four sentences. Impact states who was affected, how, and for how long, using only numbers from the notes. Timeline is a bullet list built from the extracted timeline. Root cause names the single technical trigger if the notes support one, otherwise says the root cause is not yet established and lists the leading hypotheses. Contributing factors is a bullet list of conditions that made the incident possible or made it worse. Where the clarifying questions are still unanswered, mark the gap with the words 'To confirm:' in the relevant section.

### Step 5: action items (JSON mode)

> Propose action items for this postmortem. Each item needs a short title, a one or two sentence description, a type (prevent, detect, mitigate, process), a priority (P1, P2, P3) and a suggested owner role such as 'platform team' or 'service owner'. Prefer items that remove a contributing factor or shorten detection and mitigation time. Return between 4 and 8 items. Do not propose items the notes say were already done.

### Chat follow-ups (Durable Object chat handler)

> You are continuing a conversation about one incident. You have the raw notes, the extracted timeline, the clarifying questions, the postmortem draft and the proposed action items. When the user answers a clarifying question, acknowledge it and say which part of the draft it changes, then give the revised text for that part only. When the user asks for a change, return the changed section only. Keep answers short and concrete.

