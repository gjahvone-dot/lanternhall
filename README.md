# Lanternhall: put it online

This folder is the full Lanternhall website. Once you put it online, anyone can play it in Chrome, Edge, Safari or on a phone, with no Claude account. It takes about 15 minutes, and everything except the AI is free.

## What you need

| What | Why | Cost |
|---|---|---|
| A **GitHub** account (github.com) | Holds the code | Free |
| A **Vercel** account (vercel.com, sign in with GitHub) | Runs the website | Free |
| At least one **AI key** | Powers the Game Master | Pay per use (see below) |
| A **Supabase** account (supabase.com) | Multiplayer tables | Free |

## Step 1: Put the code on GitHub

1. Unzip this folder.
2. On github.com, click **New repository**, name it `lanternhall`, and click **Create**.
3. On the next page, click **uploading an existing file** and drag in everything from the unzipped folder: the `api` folder, `index.html`, `claude-shim.js`, `package.json`, `README.md`, `.env.example`.
4. Click **Commit changes**.

## Step 2: Get an AI key (pick one or more)

- **Claude:** platform.claude.com → API keys → Create key. Add a few dollars of credit.
- **GPT:** platform.openai.com → API keys. Also copy a current model name from their models page.
- **Gemini:** aistudio.google.com → Get API key. Also copy a current model name from ai.google.dev.

Keep the keys secret. They go only into Vercel (step 4), never into the code.

## Step 3: Turn on multiplayer (Supabase)

1. On supabase.com, create a **New project** (any name, any password, nearest region).
2. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

No tables are needed. Lanternhall only uses Supabase's live channels.

## Step 4: Launch on Vercel

1. On vercel.com, click **Add New → Project** and import your `lanternhall` repository.
2. Before clicking Deploy, open **Environment Variables** and add these. Copy names exactly; `.env.example` lists them all.

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Claude key (or skip if you use another AI) |
| `OPENAI_API_KEY` + `OPENAI_MODEL` | your GPT key and model name (optional) |
| `GEMINI_API_KEY` + `GEMINI_MODEL` | your Gemini key and model name (optional) |
| `SUPABASE_URL` | from step 3 |
| `SUPABASE_ANON_KEY` | from step 3 |
| `ACCESS_CODE` | a password for friends (recommended, so strangers can't run up your AI bill) |

3. Click **Deploy**. In about a minute you get a link like `lanternhall.vercel.app`. That's your website.

To change a setting later, edit it under **Settings → Environment Variables**, then **Deployments → ⋯ → Redeploy**.

## Mixing AIs (the council)

Each AI seat can use a different provider. Set these to `anthropic`, `openai` or `gemini`:

| Variable | Seat | Does |
|---|---|---|
| `GM_AI` | Game Master | Narrates the story |
| `CHRONICLER_AI` | Chronicler | Journal, quests, relationships, Fate |
| `VOICES_AI` | Voices | Characters talking back |
| `FORGE_AI` | Forge | Classes, backstories, the quest board |

For example: Claude as the Game Master, Gemini as the Chronicler, GPT as the Voices. A seat whose provider has no key falls back to one that does. At the table, the Game Master tab shows which AI holds each seat.

## Costs and limits

- Vercel and Supabase free plans easily cover a group of friends.
- The AI is paid per use. A long evening of play is usually cents to a dollar or two per player, depending on the models you choose. Set a monthly spending limit in your AI provider's dashboard.
- `ACCESS_CODE` asks players for a password before the AI answers.
- `RATE_LIMIT` (default 80) caps AI requests per visitor every 10 minutes.

## Own domain (optional)

Buy a name like `lanternhall.gg` from any registrar, then add it in Vercel under **Settings → Domains** and follow the instructions there.

## What's saved where

- Characters, your own worlds and solo stories save in each player's browser. Clearing browser data erases them.
- Shared tables run live through Supabase. When everyone leaves, the table ends, but each player keeps their character.

## Files

- `index.html`: the whole game (pages, creator, table, dice, animations)
- `claude-shim.js`: connects the game to this site's AI server, Supabase and browser voices
- `api/ai.js`: the AI server; keeps keys secret and streams replies from Claude, GPT or Gemini
- `api/config.js`: tells the page which features are switched on (never sends keys)
