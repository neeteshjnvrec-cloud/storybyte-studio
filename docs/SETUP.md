# Setting up StoryByte Studio

About an hour of clicking for the first deploy, plus Google's and Meta's
reviews (days to weeks) before people outside your test list can connect
accounts. Everything below is free to start except the Firebase **Blaze**
(pay-as-you-go) plan, which Cloud Functions and Cloud Run need. It has a free
monthly allowance; see "What it costs" at the end.

Throughout: `PROJECT` = your Firebase project id, `REGION` = `us-central1`
(or set the `GCP_REGION` variable), `PUBLIC_URL` = `https://PROJECT.web.app`
(or your custom domain).

## 1. Firebase project

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**. Upgrade it to **Blaze**.
2. **Authentication → Sign-in method → Google → Enable.** Under **Settings → Authorized domains**, add your custom domain if you use one.
3. **Firestore Database → Create database** (production mode, any location).
4. **Storage → Get started.** Note the bucket name (e.g. `PROJECT.firebasestorage.app`).
5. **Project settings → Your apps → Web app (</>)**, register it and copy the `firebaseConfig` object. You'll paste it as the `FIREBASE_WEB_CONFIG` variable (step 6) as JSON:
   `{"apiKey":"…","authDomain":"PROJECT.firebaseapp.com","projectId":"PROJECT","storageBucket":"…","appId":"…"}`

## 2. Google Cloud: APIs, image registry, service accounts

In [Cloud Shell](https://shell.cloud.google.com) (same project):

```sh
PROJECT=your-project-id; REGION=us-central1
gcloud config set project $PROJECT
gcloud services enable youtube.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com cloudfunctions.googleapis.com
gcloud artifacts repositories create studio --repository-format=docker --location=$REGION

# The worker: reads/writes Firestore, stages Reels in Storage and signs
# their temporary URLs, reads its secrets.
gcloud iam service-accounts create storybyte-worker
W=storybyte-worker@$PROJECT.iam.gserviceaccount.com
for role in roles/datastore.user roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$W --role $role
done
gcloud iam service-accounts add-iam-policy-binding $W --member serviceAccount:$W --role roles/iam.serviceAccountTokenCreator

# Cloud Scheduler's identity for starting the worker.
gcloud iam service-accounts create storybyte-scheduler
gcloud projects add-iam-policy-binding $PROJECT \
  --member serviceAccount:storybyte-scheduler@$PROJECT.iam.gserviceaccount.com --role roles/run.invoker

# GitHub Actions' deploy identity.
gcloud iam service-accounts create github-deploy
D=github-deploy@$PROJECT.iam.gserviceaccount.com
for role in roles/firebase.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/run.admin \
    roles/iam.serviceAccountUser roles/cloudscheduler.admin roles/secretmanager.viewer roles/storage.admin \
    roles/serviceusage.serviceUsageConsumer roles/cloudfunctions.admin; do
  gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$D --role $role
done
gcloud iam service-accounts keys create github-deploy.json --iam-account $D
cat github-deploy.json   # → GitHub secret GCP_DEPLOY_KEY (step 6), then: rm github-deploy.json
```

## 3. Google sign-in for YouTube

[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials), same project:

1. **OAuth consent screen**: External; app name, support email, logo; app domain = `PUBLIC_URL`; privacy policy `PUBLIC_URL/privacy.html`; terms `PUBLIC_URL/terms.html`. Scopes:
   `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` (first comments).
2. **Create credentials → OAuth client ID → Web application.** Authorized redirect URI:
   `PUBLIC_URL/api/oauth/youtube/callback`. Copy the client id (variable `GOOGLE_CLIENT_ID`) and secret (step 5).
3. While the app is in **Testing**, only the test users you list can connect, and their connection expires every 7 days (they'll see "Reconnect"). **Publish the app** and submit it for **verification** to open it to everyone. YouTube scopes need a demo video of the connect flow and a justification for each scope.
4. **YouTube quota.** A project gets 10,000 units a day by default. Each upload also counts against a separate limit of about 100 uploads a day for the *whole app*, across all users. Thumbnails and comments cost 50 units each. To grow past that, request more through the [YouTube API Services audit and quota extension form](https://support.google.com/youtube/contact/yt_api_form).

## 4. Facebook Login for Facebook Pages and Instagram

[developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app** → type **Business**:

1. Add **Facebook Login for Business**. Valid OAuth redirect URI: `PUBLIC_URL/api/oauth/meta/callback`.
2. **App settings → Basic**: privacy policy URL, terms URL, and data deletion instructions URL (`PUBLIC_URL/privacy.html`), category, icon. Copy the **App ID** (variable `META_APP_ID`) and **App secret** (step 5).
3. Permissions used: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `business_management`.
4. In **Development** mode, only people with a role on the app (admins, developers, testers) can connect. For everyone else: **Business verification**, then **App Review** for each permission above (a screencast of connecting and a post appearing), then switch the app to **Live**.
5. Users' Instagram accounts must be **professional** (Business or Creator) accounts linked to a Facebook Page they manage.

## 5. Secrets

Generate the two app keys, keep them safe, never commit them:

```sh
openssl rand -base64 32   # → TOKEN_KEY (encrypts stored tokens; changing it disconnects everyone)
openssl rand -base64 32   # → STATE_SECRET
```

Store them, from a machine with the Firebase CLI logged in (`npm i -g firebase-tools && firebase login`), or from Cloud Shell:

```sh
firebase functions:secrets:set GOOGLE_CLIENT_SECRET --project $PROJECT
firebase functions:secrets:set META_APP_SECRET --project $PROJECT
firebase functions:secrets:set TOKEN_KEY --project $PROJECT
firebase functions:secrets:set STATE_SECRET --project $PROJECT
# Worker-only secrets:
printf '%s' 'gsk_…'  | gcloud secrets create GROQ_API_KEY --data-file=-          # console.groq.com
printf '%s' 'acct…'  | gcloud secrets create CLOUDFLARE_ACCOUNT_ID --data-file=- # Workers AI
printf '%s' 'token…' | gcloud secrets create CLOUDFLARE_API_TOKEN --data-file=-
printf '%s' 'sk_…'   | gcloud secrets create SARVAM_API_KEY --data-file=-        # optional: "Premium" voice
```

These all live in Secret Manager, so the worker reads `TOKEN_KEY` and
`GOOGLE_CLIENT_SECRET` from the same place the functions do.

## 6. GitHub repository settings

**Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `GCP_DEPLOY_KEY` | contents of `github-deploy.json` (step 2) |
| Variable | `FIREBASE_PROJECT_ID` | `PROJECT` |
| Variable | `FIREBASE_WEB_CONFIG` | the JSON from step 1.5 |
| Variable | `FIREBASE_STORAGE_BUCKET` | the bucket from step 1.4 |
| Variable | `GOOGLE_CLIENT_ID` | step 3 |
| Variable | `META_APP_ID` | step 4 |
| Variable | `PUBLIC_URL` | e.g. `https://PROJECT.web.app` |
| Variable | `GCP_REGION` | optional, default `us-central1` |

Then **Actions → Deploy Firebase → Run workflow**. Also set `.firebaserc`'s
project id if you deploy from your own machine.

## 7. The worker

**Actions → Deploy worker → Run workflow.** This builds the image, creates
the `storybyte-worker` Cloud Run Job, and schedules it at 5 minutes past every
hour. Each run queues whatever is due and makes up to `MAX_JOBS_PER_RUN`
videos (default 3). Overlapping runs share the queue safely.

To run it right now instead of waiting for the hour:

```sh
gcloud run jobs execute storybyte-worker --region $REGION
```

Logs: **Cloud Run → Jobs → storybyte-worker → Logs.**

## 8. Try it

1. Open `PUBLIC_URL`, sign in, **+ YouTube channel**, **+ Facebook Page & Instagram**.
2. **+ New profile**: topic, language, schedule. Under **Post to**, pick the accounts → **Save**.
3. **Make a Short now**, then execute the worker (step 7) or wait for the hour. The job appears under **Recent videos** with links to the posts.

## What it costs (rough, October 2026 prices)

- **Cloud Run** (4 vCPU / 8 GiB): about $0.05 per Short (around 10 minutes), $0.50–1 per long episode. The free tier covers the first ~50 vCPU-hours a month.
- **Cloudflare Workers AI**: about 10–18 scene pictures per Short. The free 10,000 neurons a day covers a handful of Shorts; beyond that it's $0.011 per 1,000 neurons.
- **Groq**: the free tier's per-minute token limits handle a few videos an hour. For many users, use a paid key.
- **Firestore, Hosting, Functions, Storage**: pennies at this scale.

Per-user limits live in code: 3 profiles (`MAX_PROFILES_PER_USER`), 3 Shorts
per profile per day, 3 "Run now" per day. Raise them only once your quotas
can carry it.
