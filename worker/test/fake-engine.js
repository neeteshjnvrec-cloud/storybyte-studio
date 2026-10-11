// Stands in for engine/build-landscape-episode.js in long.test.js: reads the
// same environment and writes the same files, without any AI or rendering.
const fs = require('fs');
const path = require('path');

const env = process.env;
const seriesDir = path.join(env.EPISODE_WORKDIR, 'episodes', 'krishna-leela');
const dir = path.join(seriesDir, `season-${env.EPISODE_SEASON}`, `episode-${env.EPISODE_NUMBER}`);
fs.mkdirSync(dir, { recursive: true });
const bibleFile = path.join(seriesDir, 'series.json');
const previous = fs.existsSync(bibleFile) ? JSON.parse(fs.readFileSync(bibleFile, 'utf8')) : { episodes: [] };
fs.writeFileSync(bibleFile, JSON.stringify({ ...previous, episodes: [...previous.episodes, env.EPISODE_NUMBER] }));
fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify({ metadata: { title: `Ep ${env.EPISODE_NUMBER}`, description: 'desc', tags: ['t'] } }));
fs.writeFileSync(path.join(dir, 'episode.mp4'), 'video');
fs.writeFileSync(path.join(dir, 'thumbnail.jpg'), 'jpg');
fs.writeFileSync(path.join(env.EPISODE_WORKDIR, 'engine-env.json'), JSON.stringify(
  Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('EPISODE_')))));
