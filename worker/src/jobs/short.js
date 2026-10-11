/**
 * One Short for one profile: write a complete story, narrate it, illustrate
 * it full-screen 9:16 in the profile's art style, burn in captions, and
 * publish it to the profile's connected YouTube / Facebook / Instagram.
 *
 * Same proven pipeline as the original daily job, made per-profile:
 * stays under YouTube's 3-minute Shorts limit (speed-up, then a shorter
 * rewrite), picture every ~9s, captions that follow the voice, a devotional
 * music bed for devotional profiles, a question as the first comment.
 */
const fs = require('fs');
const path = require('path');
const { writeShortStory } = require('../content/story');
const { synth } = require('../engine/lib/narrate');
const { synthSarvam } = require('../engine/lib/sarvam-tts');
const { parseSrt, toCaptionLines } = require('../engine/lib/subtitles');
const { buildVideoScenes } = require('../engine/lib/video-scenes');
const { bakeInCaptions } = require('../engine/lib/caption-frames');
const { buildStoryVideo } = require('../engine/lib/video');
const { mixDevotionalMusic } = require('../engine/lib/devotional-music');
const { renderFallbackCover } = require('../engine/lib/fallback-cover');
const { styleOfDay, fitShort } = require('../engine/lib/short-style');
const { GENERAL_HASHTAGS } = require('../engine/lib/devotional-calendar');
const { exactDuration, retime, voiceFor } = require('./media');
const { publishAll } = require('./publish');

const NICHE_GENRE = { devotional: 'devotional', kids: 'adventure', motivation: 'motivation', mystery: 'mystery',
  romance: 'romance', horror: 'horror', history: 'drama', sleep: 'sleep' };

async function narrate(profile, text, audio, subs) {
  if (profile.voice === 'premium') {
    const premium = await synthSarvam(text, { out: audio, subsOut: subs, language: profile.language || 'hi' });
    if (premium) return premium;
  }
  return synth(text, { voice: voiceFor(profile), rate: profile.niche === 'devotional' ? '-5%' : undefined }, audio, subs);
}

async function runShort({ uid, profile, jobId, workDir, now = new Date() }) {
  const genre = NICHE_GENRE[profile.niche] || 'drama';
  const devotional = profile.niche === 'devotional';
  const look = styleOfDay(`${profile.id}:${now.toISOString().slice(0, 10)}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1. Story — rewritten once, shorter, if it can't fit a Short even sped up.
  let story = await writeShortStory(profile, { now, look });
  const audio = path.join(workDir, 'narration.mp3');
  const subs = path.join(workDir, 'narration.srt');
  let narrated = await narrate(profile, story.text, audio, subs);
  if (!fitShort(exactDuration(audio)).fits) {
    console.log(`  ✂️  ${Math.round(exactDuration(audio))}s is too long for a Short — rewriting it shorter`);
    const shorter = await writeShortStory(profile, { now, look, maxWords: 260 });
    story = { ...story, text: shorter.text };
    narrated = await narrate(profile, story.text, audio, subs);
  }

  // 2. Timing on the (possibly sped-up) clock.
  const dur = exactDuration(audio);
  const { tempo, tailSec } = fitShort(dur);
  const videoDur = dur / tempo;
  let cues = narrated?.subtitlesPath ? parseSrt(fs.readFileSync(subs, 'utf8')) : [];
  if (tempo !== 1) cues = cues.map((c) => ({ ...c, start: c.start / tempo, end: c.end / tempo }));

  // 3. Pictures.
  const sceneCount = Math.max(8, Math.min(18, Math.round(videoDur / 9)));
  let scenes = cues.length ? await buildVideoScenes({
    storyId: `${profile.id}-${jobId}`, title: story.title, text: story.text, genre, description: story.description,
    cues, audioDurSec: videoDur, outDir: workDir, sceneCount, portrait: true, iconography: devotional,
    style: profile.style, context: [story.topic?.deity?.katha, story.topic?.occasion?.name].filter(Boolean).join(' '),
  }) : null;
  if (!scenes) {
    // No timings or no art: themed cards, evenly spaced, so the video still posts.
    scenes = [];
    for (let i = 0; i < 6; i++) {
      const file = path.join(workDir, `card-${i}.jpg`);
      fs.writeFileSync(file, await renderFallbackCover(genre, { width: 1080, height: 1920 }));
      scenes.push({ file, duration: videoDur / 6 });
    }
  }
  scenes[scenes.length - 1] = { ...scenes[scenes.length - 1], duration: scenes[scenes.length - 1].duration + tailSec };

  // 4. Sound, captions, render.
  const total = videoDur + tailSec;
  const mixed = devotional
    ? mixDevotionalMusic(audio, path.join(workDir, 'mix.mp3'), { variant: look.seed, tempo, tailSec })
    : retime(audio, path.join(workDir, 'mix.mp3'), { tempo, tailSec });
  if (!mixed) throw new Error('could not prepare the audio');
  if (cues.length) scenes = await bakeInCaptions(scenes, toCaptionLines(cues), workDir, total, { format: 'short', look });
  const videoPath = buildStoryVideo({ scenes, audioPath: mixed, outPath: path.join(workDir, 'short.mp4'), format: 'short', look });
  if (!videoPath) throw new Error('video render failed');
  const videoSec = exactDuration(videoPath);

  // 5. Publish to every connected target of this profile.
  const hashtags = [...new Set([...(profile.hashtags || []), ...story.hashtags, ...(devotional ? GENERAL_HASHTAGS : [])])];
  const description = [story.description, profile.footer, hashtags.join(' ')].filter(Boolean).join('\n\n');
  const results = await publishAll({
    uid, profile, jobId, videoPath,
    post: {
      title: story.socialTitle, description, caption: `${story.socialTitle}\n\n${description}`,
      tags: [...story.searchTags, ...(profile.tags || [])], language: profile.language,
      isShort: videoSec <= 180, comment: story.commentQuestion,
    },
    platforms: ['youtube', 'facebook', 'instagram'],
  });
  return { kind: 'short', title: story.socialTitle, durationSec: Math.round(videoSec), results };
}

module.exports = { runShort, NICHE_GENRE };
