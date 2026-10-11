/** Small media helpers shared by the short and long jobs. */
const { execFileSync } = require('child_process');

function exactDuration(file) {
  try {
    return parseFloat(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()) || 0;
  } catch {
    return 0;
  }
}

/** Narration sped up by `tempo` (pitch kept) with `tailSec` of silence after
 *  — the non-devotional counterpart of the music bed's timing. */
function retime(input, output, { tempo = 1, tailSec = 0 }) {
  execFileSync('ffmpeg', ['-y', '-i', input, '-af', `atempo=${tempo.toFixed(4)},apad=pad_dur=${tailSec}`,
    '-c:a', 'libmp3lame', '-b:a', '160k', output], { stdio: 'pipe' });
  return output;
}

// Narrator voices (edge-tts). "premium" uses Sarvam AI when SARVAM_API_KEY
// is configured, falling back to the female voice.
const VOICES = {
  hi: { female: 'hi-IN-SwaraNeural', male: 'hi-IN-MadhurNeural' },
  en: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
};
function voiceFor(profile) {
  const lang = VOICES[profile.language] ? profile.language : 'en';
  return VOICES[lang][profile.voice === 'male' ? 'male' : 'female'];
}

module.exports = { exactDuration, retime, voiceFor, VOICES };
