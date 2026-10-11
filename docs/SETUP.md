# Setting up StoryByte Studio (free plans only)

Everything here runs without a paid plan or a credit card:

| Part | Runs on |
| --- | --- |
| Sign-in, database, dashboard website | Firebase **Spark** (free) plan |
| API: connecting accounts, "Run now", account deletion | Cloudflare Workers (free) |
| Making and publishing the videos, every hour | GitHub Actions, like the StoryByte app's daily posts |

Plan on about an hour. Google's and Meta's reviews come later and are only
needed before people outside your test list can connect accounts.

You'll collect these values on the way, then paste them into GitHub in step 7:

| Value | From step |
| --- | --- |
| Firebase project id, web config | 1 |
| `FIREBASE_SERVICE_ACCOUNT` (secret) | 2 |
| `API_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DEPLOY_TOKEN`, `CLOUDFLARE_API_TOKEN` | 3 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 4 |
| `META_APP_ID`, `META_APP_SECRET` | 5 |
| `TOKEN_KEY`, `STATE_SECRET`, `GROQ_API_KEY`, `SARVAM_API_KEY` | 6 |

## 1. Firebase project (Spark plan)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Create a project**, e.g. `storybyte-studio`. Google Analytics: off. Never click **Upgrade** — everything here works on Spark.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, choose your support email → **Save**.
3. **Build → Firestore Database → Create database** → **Standard** edition → location **asia-south1 (Mumbai)** (can't be changed later) → **production mode** → **Create**.
4. Skip **Storage** — it isn't used (and now needs the paid plan).
5. ⚙️ **Project settings → General → Your apps → Web (`</>`)**, nickname `studio-web`, tick **Also set up Firebase Hosting** → **Register app**. Copy the `firebaseConfig` values and write them as JSON on one line — this is the `FIREBASE_WEB_CONFIG` variable:
   `{"apiKey":"…","authDomain":"PROJECT.firebaseapp.com","projectId":"PROJECT","storageBucket":"…","appId":"…"}`
6. Note the **Project ID**. Your dashboard will be at `https://PROJECT.web.app` (the `PUBLIC_URL` variable).

## 2. Service account key

The worker and the API use it to read and write the database; the deploy
workflow uses it to publish the dashboard.

1. ⚙️ **Project settings → Service accounts → Generate new private key** → **Generate key**. A `.json` file downloads. **This is a password: never share it, paste it in chat, or commit it.** You'll paste its whole contents into the GitHub secret `FIREBASE_SERVICE_ACCOUNT` (step 7), then delete the file.
2. Let it deploy: [console.cloud.google.com/iam-admin/iam](https://console.cloud.google.com/iam-admin/iam) (pick your project at the top) → find `firebase-adminsdk-…@PROJECT.iam.gserviceaccount.com` → ✏️ **Edit** → **Add another role**: **Firebase Admin**, and **Service Usage Consumer** → **Save**. (No billing needed.)

## 3. Cloudflare (API + scene pictures)

Use the Cloudflare account you already use for StoryByte's pictures, or a new free one.

1. **Account ID**: [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → right-hand side → **Account ID** (`CLOUDFLARE_ACCOUNT_ID`).
2. **Your workers.dev subdomain**: **Workers & Pages → Overview** shows `<something>.workers.dev` (choose one if asked). Your API will live at
   `https://storybyte-studio-api.<something>.workers.dev` — that's `API_URL`.
3. **Deploy token**: **My Profile → API Tokens → Create Token → Edit Cloudflare Workers** template → **Continue → Create Token** (`CLOUDFLARE_DEPLOY_TOKEN`).
4. **Pictures token** (`CLOUDFLARE_API_TOKEN`): reuse StoryByte's Workers AI token, or **Create Custom Token** with permission **Account → Workers AI → Edit**.

The free Workers AI allowance is 10,000 neurons a day, shared across
everything on the account, which covers a handful of Shorts a day. Videos
still get made beyond that, with simpler fallback pictures.

## 4. Google sign-in for YouTube

[console.cloud.google.com](https://console.cloud.google.com), same project as Firebase:

1. **APIs & Services → Library → YouTube Data API v3 → Enable.**
2. **Google Auth Platform (OAuth consent screen)** → **Get started**: app name `StoryByte Studio`, your email, audience **External**. Then:
   - **Branding**: app home page `PUBLIC_URL`, privacy policy `PUBLIC_URL/privacy.html`, terms `PUBLIC_URL/terms.html`.
   - **Data access → Add scopes**: `…/auth/youtube.upload`, `…/auth/youtube.readonly`, `…/auth/youtube.force-ssl`.
   - **Audience → Test users → Add users**: your Gmail and anyone testing with you (up to 100).
3. **Clients → Create client → Web application**. **Authorized redirect URIs**: `API_URL/oauth/youtube/callback`. Copy the **Client ID** (`GOOGLE_CLIENT_ID`) and **Client secret** (`GOOGLE_CLIENT_SECRET`).

While the app is in **Testing**, only test users can connect, and their
YouTube connection expires every 7 days — the dashboard shows **Reconnect**.
Opening it to everyone needs Google's verification (later; it's easier with
your own domain than `workers.dev`).

## 5. Facebook Login for Pages and Instagram

[developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app** → use case **Other** → type **Business**:

1. **Add product → Facebook Login for Business → Settings → Valid OAuth Redirect URIs**: `API_URL/oauth/meta/callback` → **Save**.
2. **App settings → Basic**: privacy policy URL `PUBLIC_URL/privacy.html`, terms `PUBLIC_URL/terms.html`, user data deletion `PUBLIC_URL/privacy.html`, category, icon → **Save**. Copy **App ID** (`META_APP_ID`) and **App secret** (`META_APP_SECRET`).
3. **App roles → Roles**: add anyone testing with you. In **Development** mode only they can connect; that's all you need for now.
4. Instagram accounts must be **Professional** (Business or Creator) and linked to a Facebook Page you manage.

## 6. Keys

1. `TOKEN_KEY` and `STATE_SECRET` — two random keys. Easiest: open any browser tab, press **F12 → Console**, paste this, press Enter, and copy the result; do it twice, once for each:
   ```js
   btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
   ```
   Keep `TOKEN_KEY` safe: changing it later disconnects every account.
2. `GROQ_API_KEY`: reuse StoryByte's, or create one at [console.groq.com/keys](https://console.groq.com/keys).
3. `SARVAM_API_KEY` (optional): for the "Premium" voice.

## 7. GitHub settings

In this repository: **Settings → Secrets and variables → Actions**.

**Secrets** tab → **New repository secret** for each:

| Secret | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | the whole `.json` file from step 2 |
| `TOKEN_KEY`, `STATE_SECRET` | step 6 |
| `GOOGLE_CLIENT_SECRET` | step 4 |
| `META_APP_SECRET` | step 5 |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DEPLOY_TOKEN`, `CLOUDFLARE_API_TOKEN` | step 3 |
| `GROQ_API_KEY`, `SARVAM_API_KEY` (optional) | step 6 |

**Variables** tab → **New repository variable** for each:

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | step 1 |
| `FIREBASE_WEB_CONFIG` | step 1 (one-line JSON) |
| `PUBLIC_URL` | `https://PROJECT.web.app` |
| `API_URL` | `https://storybyte-studio-api.<something>.workers.dev` |
| `GOOGLE_CLIENT_ID` | step 4 |
| `META_APP_ID` | step 5 |

## 8. Deploy

**Actions** tab:

1. **Deploy API → Run workflow.** When it's green, open `API_URL/nope` in a browser — `{"error":"not found"}` means the API is up.
2. **Deploy Firebase → Run workflow.** Then open `PUBLIC_URL`.
3. **Make videos** runs by itself at 5 minutes past every hour. To run it now: **Make videos → Run workflow**.

Later pushes to `main` redeploy automatically.

## 9. Try it

1. Open `PUBLIC_URL` → **Sign in with Google**.
2. **+ YouTube channel**, then **+ Facebook Page & Instagram**.
3. **+ New profile**: topic, language, style, voice, times; under **Post to**, pick your accounts → **Save**.
4. **Make a Short now**, then **Actions → Make videos → Run workflow** (or wait for the hour). The video appears under **Recent videos** with links, about 10–15 minutes later.

## Free-plan limits

- **GitHub Actions**: unlimited minutes if this repository is public, 2,000 a month if private (a Short takes ~10–15 minutes, an episode up to ~1.5 hours). Scheduled runs can start a few minutes late.
- **Firestore (Spark)**: 50,000 reads and 20,000 writes a day — far more than this uses.
- **Cloudflare Workers**: 100,000 API requests a day. **Workers AI**: see step 3.
- **YouTube**: about 100 uploads a day for the whole app (all users together) by default.
- **Opening to the public**: see "Before opening it to the public" in the README — the worker should move off GitHub Actions then.
