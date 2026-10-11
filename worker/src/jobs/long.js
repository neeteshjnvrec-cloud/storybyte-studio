/**
 * One long (~15-minute, 1920x1080) episode of a profile's series, published
 * to its connected YouTube channel (with chapters and a thumbnail) and
 * Facebook Page.
 *
 * Runs the original landscape-episode engine unchanged as a child process
 * (engine/build-landscape-episode.js, publishing disabled) in a per-job work
 * directory. The series bible — recurring characters, their looks, the
 * story so far, the series' art style — lives in Firestore at
 * users/{uid}/series/{profileId} and is restored into the work directory
 * before each episode and saved back after, so episode N continues episode
 * N-1 with the same names and faces.
 *
 * Instagram is skipped: a 15-minute 16:9 video is not a Reel.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { db, FieldValue } = require('../firebase');
const { voiceFor } = require('./media');
const { publishAll } = require('./publish');

const ENGINE = path.join(__dirname, '..', 'engine', 'build-landscape-episode.js');

// Must match slug() in build-landscape-episode.js — it decides the folder
// the engine reads the bible from.
function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'series';
}

function runEngine(env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile('node', [ENGINE], { env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(`episode engine failed: ${(stderr || error.message).slice(-1500)}`)) : resolve(stdout)));
    child.stdout.on('data', (d) => process.stdout.write(d));
  });
}

async function runLong({ uid, profile, jobId, workDir }) {
  const long = profile.long || {};
  const seriesTitle = String(long.seriesTitle || profile.name || 'My Series').slice(0, 80);
  const seriesRef = db.doc(`users/${uid}/series/${profile.id}`);
  const state = (await seriesRef.get()).data() || {};
  const season = String(long.season || state.season || 1);
  const episode = String(state.season && String(state.season) !== season ? 1 : (Number(state.episode) || 0) + 1);

  const seriesDir = path.join(workDir, 'episodes', slug(seriesTitle));
  fs.mkdirSync(seriesDir, { recursive: true });
  if (state.bible) fs.writeFileSync(path.join(seriesDir, 'series.json'), JSON.stringify(state.bible));

  console.log(`🎬 ${seriesTitle} — season ${season} episode ${episode}`);
  await runEngine({
    EPISODE_WORKDIR: workDir,
    EPISODE_TITLE: seriesTitle,
    EPISODE_SEASON: season,
    EPISODE_NUMBER: episode,
    EPISODE_LANGUAGE: profile.language === 'hi' ? 'hi' : 'en',
    EPISODE_GENRE: String(long.genre || (profile.niche === 'custom' ? profile.customNiche : profile.niche) || 'drama').slice(0, 120),
    EPISODE_STYLE: profile.style || '',
    EPISODE_VOICE: voiceFor(profile),
    EPISODE_PUBLISH: 'false',
  }, 3 * 3600 * 1000);

  const episodeDir = path.join(seriesDir, `season-${season}`, `episode-${episode}`);
  const story = JSON.parse(fs.readFileSync(path.join(episodeDir, 'story.json'), 'utf8'));
  const bible = JSON.parse(fs.readFileSync(path.join(seriesDir, 'series.json'), 'utf8'));
  const meta = story.metadata || {};
  const videoPath = path.join(episodeDir, 'episode.mp4');
  const thumbnailPath = path.join(episodeDir, 'thumbnail.jpg');

  const description = [meta.description || story.description, profile.footer].filter(Boolean).join('\n\n');
  const results = await publishAll({
    uid, profile, jobId, videoPath, thumbnailPath,
    post: {
      title: meta.title || `${seriesTitle} | Season ${season} Episode ${episode}`,
      description, caption: description, tags: meta.tags || [], language: profile.language, isShort: false,
    },
    platforms: ['youtube', 'facebook'],
  });

  // The next episode continues from this one, whether or not every
  // platform accepted it — the story already moved on in the bible.
  await seriesRef.set({ title: seriesTitle, season: Number(season), episode: Number(episode), bible,
    updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { kind: 'long', title: meta.title || story.generatedTitle, season: Number(season), episode: Number(episode), results };
}

module.exports = { runLong, slug };
