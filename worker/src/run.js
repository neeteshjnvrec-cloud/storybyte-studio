/**
 * The worker's entry point, run hourly by Cloud Scheduler -> Cloud Run Job
 * (or by hand for testing):
 *
 *   node src/run.js              enqueue what's due, then process the queue
 *   node src/run.js --job <path> process one job document (users/{uid}/jobs/{id})
 *
 * Jobs live at users/{uid}/jobs/{jobId} — the dashboard shows them, and its
 * "Run now" button creates one directly. A due slot always gets the same
 * job id, so a scheduler retry or an overlapping run never posts twice.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, FieldValue, Timestamp } = require('./firebase');
const { dueSlots } = require('./schedule');
const { runShort } = require('./jobs/short');
const { runLong } = require('./jobs/long');

const MAX_JOBS = Number(process.env.MAX_JOBS_PER_RUN || 3);
const LEASE_MS = 4 * 3600e3; // a long episode can take a couple of hours to render
const MAX_ATTEMPTS = 2;
const LOOKBACK_MS = 6 * 3600e3; // a missed scheduler run still catches up within 6h
// Each profile is up to 3 Shorts a day plus episodes; this bounds what one
// account can make the shared worker (and the shared API quotas) do.
const MAX_PROFILES_PER_USER = Number(process.env.MAX_PROFILES_PER_USER || 3);

const jobIdFor = (profileId, kind, at) => `${profileId}_${kind}_${new Date(at).toISOString().replace(/[:.]/g, '-')}`;

async function enqueueDue(now = Date.now()) {
  const stateRef = db.doc('system/scheduler');
  const last = (await stateRef.get()).data()?.lastRunAt?.toMillis?.() || now - 3600e3;
  const from = Math.max(last, now - LOOKBACK_MS);
  const profiles = await db.collectionGroup('profiles').where('active', '==', true).get();
  let created = 0;
  const perUser = {};
  for (const doc of profiles.docs) {
    const uid = doc.ref.parent.parent.id;
    perUser[uid] = (perUser[uid] || 0) + 1;
    if (perUser[uid] > MAX_PROFILES_PER_USER) continue;
    for (const slot of dueSlots(doc.data(), from, now)) {
      try {
        await db.doc(`users/${uid}/jobs/${jobIdFor(doc.id, slot.kind, slot.at)}`).create({
          uid, profileId: doc.id, kind: slot.kind, slotAt: Timestamp.fromMillis(slot.at), source: 'schedule',
          status: 'queued', attempts: 0, createdAt: FieldValue.serverTimestamp(),
        });
        created += 1;
      } catch (e) {
        if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS: queued by an earlier run
      }
    }
  }
  await stateRef.set({ lastRunAt: Timestamp.fromMillis(now) }, { merge: true });
  console.log(`📅 ${profiles.size} active profile(s), ${created} job(s) queued`);
}

/** Atomically moves a queued (or lease-expired) job to running. */
async function claim(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const job = snap.data();
    if (!job) return null;
    const stale = job.status === 'running' && job.leaseUntil?.toMillis() < Date.now();
    if (job.status !== 'queued' && !stale) return null;
    if ((job.attempts || 0) >= MAX_ATTEMPTS) {
      tx.update(ref, { status: 'failed', error: job.error || 'gave up after repeated attempts', finishedAt: FieldValue.serverTimestamp() });
      return null;
    }
    tx.update(ref, { status: 'running', attempts: (job.attempts || 0) + 1, startedAt: FieldValue.serverTimestamp(),
      leaseUntil: Timestamp.fromMillis(Date.now() + LEASE_MS) });
    return job;
  });
}

async function processJob(ref) {
  const job = await claim(ref);
  if (!job) return;
  const uid = ref.parent.parent.id;
  const profileSnap = await db.doc(`users/${uid}/profiles/${job.profileId}`).get();
  if (!profileSnap.exists) {
    await ref.update({ status: 'skipped', error: 'profile was deleted', finishedAt: FieldValue.serverTimestamp() });
    return;
  }
  const profile = { id: profileSnap.id, ...profileSnap.data() };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `job-${ref.id.slice(0, 40)}-`));
  console.log(`\n▶️  ${uid} / ${profile.name || profile.id} / ${job.kind} (${ref.id})`);
  try {
    const run = job.kind === 'long' ? runLong : runShort;
    const result = await run({ uid, profile, jobId: ref.id, workDir });
    const posted = Object.values(result.results || {}).some((r) => r.posted);
    await ref.update({ status: posted ? 'done' : 'failed', result, error: posted ? FieldValue.delete() : 'not published anywhere',
      finishedAt: FieldValue.serverTimestamp() });
  } catch (e) {
    console.error(`  ✗ ${e.stack || e}`);
    // Back to the queue for one more attempt (claim() gives up after MAX_ATTEMPTS).
    await ref.update({ status: 'queued', error: String(e.message || e).slice(0, 1000), leaseUntil: FieldValue.delete() });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function processQueue() {
  const queued = await db.collectionGroup('jobs').where('status', '==', 'queued').orderBy('createdAt').limit(MAX_JOBS).get();
  const stale = await db.collectionGroup('jobs').where('status', '==', 'running')
    .where('leaseUntil', '<', Timestamp.now()).limit(MAX_JOBS).get();
  const refs = [...queued.docs, ...stale.docs].slice(0, MAX_JOBS).map((d) => d.ref);
  console.log(`🧾 ${refs.length} job(s) to process`);
  for (const ref of refs) await processJob(ref);
}

async function main() {
  const i = process.argv.indexOf('--job');
  if (i > 0) return processJob(db.doc(process.argv[i + 1]));
  await enqueueDue();
  await processQueue();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { enqueueDue, processQueue, processJob, claim, jobIdFor };
