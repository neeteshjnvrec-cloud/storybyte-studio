# StoryByte Studio

Anyone signs in with Google, connects **their own** YouTube channel, Facebook
Page and Instagram account, and gets narrated, illustrated story videos made
and published for them automatically:

- **Shorts / Reels** (9:16, under 3 minutes) up to 3 times a day, to all three platforms
- **Long episodes** (16:9, ~15 minutes, a continuing series with recurring characters) on chosen weekdays, to YouTube and Facebook

Per profile: topic/niche (devotional katha, kids, motivation, mystery, horror,
romance, history, sleep, or your own), language (Hindi/English), art style
(3D cartoon, 2D cartoon, realistic, illustration), voice, time zone and
schedules. A user can have up to 3 profiles, each posting to different
accounts.

Built from the StoryByte app's own social video pipeline: the same story
writing, narration, scene art (with accurate deity iconography for devotional
stories), captions, music and rendering.

## How it works

Everything runs on free plans: Firebase **Spark** (sign-in, database,
website), a **Cloudflare Worker** (the API), and **GitHub Actions** (making
the videos, hourly — the same way the StoryByte app's daily posts run).

```
 web/ (Firebase Hosting)          api/ (Cloudflare Worker)             Firestore
 dashboard: sign in, connect, ──▶ OAuth with Google & Meta,       ──▶ users/{uid}/connections, profiles, jobs, series
 profiles, schedules, jobs        encrypts tokens, "Run now"          tokens/{uid}__{conn}  (encrypted, server-only)
                                                                           ▲
 GitHub Actions (hourly) ──▶ worker/ ──────────────────────────────────────┘
                             queue due slots → write story (Groq) → narrate (Edge TTS / Sarvam)
                             → scene art (Cloudflare FLUX) → captions + music → ffmpeg
                             → upload straight to each platform with that user's own tokens → record links
```

- **Isolation:** each job uses only its owner's connected accounts. Tokens are AES-256-GCM encrypted with a key only the API and worker hold; the browser never sees them, and Firestore rules deny all client access to `tokens/`.
- **Nothing hosted:** videos go straight from the build machine to YouTube, Facebook and Instagram (Instagram's direct upload), so no storage bucket is needed and no copies are kept.
- **Exactly once:** a due slot always maps to the same job id, so retries and overlapping runs never double-post. Jobs are leased while running and retried once.
- **Disclosure:** YouTube uploads are marked as containing synthetic (AI-generated) media, and kids' stories are marked "made for kids", as YouTube's policies require.

## Before opening it to the public

GitHub Actions is for a repository's own automation, not for powering a
public service, so this setup is meant for you and the test users you add
while Google and Meta review your apps (until then, nobody else can connect
accounts anyway). To open it to everyone, run the worker somewhere else —
it's a plain Node app with a `Dockerfile` (`worker/`), e.g. a Cloud Run Job
(about $0.05 per Short) or any always-on machine running
`node src/run.js` hourly.

## Layout

| Path | What |
| --- | --- |
| `web/` | Dashboard (plain HTML/JS, Firebase JS SDK), Terms and Privacy templates |
| `api/` | Cloudflare Worker: OAuth start/callback for YouTube and Meta, disconnect, run-now, delete account |
| `worker/src/run.js` | Scheduler + queue: `node src/run.js` or `node src/run.js --job users/{uid}/jobs/{id}` |
| `worker/src/jobs/` | `short.js`, `long.js` (wraps the episode engine), `publish.js` |
| `worker/src/publish/` | YouTube, Facebook (resumable upload), Instagram Reels (direct upload) |
| `worker/src/engine/` | The rendering engine shared with the StoryByte app |
| `firestore.rules` | Access rules |
| `.github/workflows/` | `worker.yml` (hourly videos), `deploy-firebase.yml`, `deploy-api.yml`, `ci.yml` |

## Setup

See **[docs/SETUP.md](docs/SETUP.md)** — all on free plans.

## Development

```sh
cd worker && npm ci && npm test
cd api && npm ci && npm test
```
