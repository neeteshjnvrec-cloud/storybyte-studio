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

```
 web/ (Firebase Hosting)            functions/ (/api)                    Firestore
 dashboard: sign in, connect,  ──▶  OAuth with Google & Meta,       ──▶  users/{uid}/connections, profiles, jobs, series
 profiles, schedules, jobs          encrypts tokens, "Run now"           tokens/{uid}__{conn}  (encrypted, server-only)
                                                                              ▲
 Cloud Scheduler (hourly) ──▶ worker/ (Cloud Run Job) ───────────────────────┘
                              queue due slots → write story (Groq) → narrate (Edge TTS / Sarvam)
                              → scene art (Cloudflare FLUX) → captions + music → ffmpeg
                              → publish with that user's own tokens → record links
```

- **Isolation:** each job uses only its owner's connected accounts. Tokens are AES-256-GCM encrypted with a key only the functions and worker hold; the browser never sees them, and Firestore rules deny all client access to `tokens/`.
- **Exactly once:** a due slot always maps to the same job id, so retries and overlapping runs never double-post. Jobs are leased while running and retried once.
- **Disclosure:** YouTube uploads are marked as containing synthetic (AI-generated) media, and kids' stories are marked "made for kids", as YouTube's policies require.

## Layout

| Path | What |
| --- | --- |
| `web/` | Dashboard (plain HTML/JS, Firebase JS SDK), Terms and Privacy templates |
| `functions/` | `/api`: OAuth start/callback for YouTube and Meta, disconnect, run-now; account deletion cleanup |
| `worker/src/run.js` | Scheduler + queue: `node src/run.js` or `node src/run.js --job users/{uid}/jobs/{id}` |
| `worker/src/jobs/` | `short.js`, `long.js` (wraps the episode engine), `publish.js` |
| `worker/src/publish/` | YouTube, Facebook (resumable upload), Instagram Reels (via a 2-hour signed URL) |
| `worker/src/engine/` | The rendering engine shared with the StoryByte app |
| `firestore.rules`, `storage.rules` | Access rules |

## Setup

See **[docs/SETUP.md](docs/SETUP.md)**: Firebase (Blaze), Google OAuth and YouTube
API verification, a Meta app with App Review, secrets, and the two deploy
workflows.

## Development

```sh
cd worker && npm ci && npm test
cd functions && npm ci && npm test
```
