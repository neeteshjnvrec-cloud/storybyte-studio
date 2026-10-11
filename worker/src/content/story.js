/**
 * Writes one complete short story for a profile: the text to narrate plus
 * the social metadata (title, hook, description, search tags, a question
 * for the first comment).
 *
 * Devotional profiles keep everything the original pipeline learnt: the
 * weekday deity's katha, the day's Navratri goddess, devotional festivals,
 * and what India is searching for right now. Other niches are written from
 * their own brief, or from the profile's custom description.
 */
const Groq = require('groq-sdk');
const { extractJson } = require('../engine/lib/carousel-copy');
const { deityOfDay, navratriDeity, istDate } = require('../engine/lib/devotional-calendar');
const { getOccasion, occasionPhrase } = require('../engine/lib/occasions');
const { devotionalTrends } = require('../engine/lib/trends');

const MODELS = (process.env.GROQ_MODEL || 'openai/gpt-oss-120b,openai/gpt-oss-20b,llama-3.3-70b-versatile,qwen/qwen3.8-27b')
  .split(',').map((s) => s.trim()).filter(Boolean);

const NICHES = {
  devotional: 'a touching devotional katha with spiritual wisdom, told faithfully to the traditional version',
  kids: 'a fun, wholesome story for children aged 4-9 with a gentle lesson, simple words and a happy ending',
  motivation: 'an inspiring story about overcoming a real challenge, ending on a line the viewer will remember',
  mystery: 'a gripping short mystery with a clever, fair twist revealed at the end',
  romance: 'a warm, emotional short romance with a satisfying ending',
  horror: 'a chilling, spooky short story (no gore) with an eerie twist at the end',
  history: 'a true, vivid story from history, accurate to the facts, told like a story',
  sleep: 'a calm, soothing bedtime story with soft imagery and a slow, gentle pace',
};

const LANGUAGES = { hi: 'Hindi (Devanagari script)', en: 'English' };

/** What today's devotional story is about (same rules as the original
 *  daily job): Navratri goddess > devotional festival > weekday deity. */
function devotionalTopic(now) {
  const date = istDate(now);
  const occasion = getOccasion(date);
  const navratri = navratriDeity(date);
  if (navratri) return { deity: navratri, occasion: occasion?.genre === 'devotional' ? occasion : null, date };
  if (occasion?.genre === 'devotional') return { occasion, date };
  return { deity: deityOfDay(date, now), date };
}

async function ask(groq, sys, user, maxTokens) {
  const errors = [];
  for (const model of MODELS) {
    for (const strict of [true, false]) {
      try {
        const c = await groq.chat.completions.create({
          model, temperature: 0.85, top_p: 0.95, max_tokens: maxTokens,
          ...(strict ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        });
        return extractJson(c.choices[0].message.content || '');
      } catch (e) {
        errors.push(`${model}${strict ? '' : ' (relaxed)'}: ${e.message.slice(0, 80)}`);
        if (/invalid api key|authentication/i.test(e.message)) throw e;
        if (!strict || !/JSON/i.test(e.message)) break;
      }
    }
  }
  throw new Error(`All models failed: ${errors.join(' | ')}`);
}

/**
 * Returns { title, socialTitle, description, text, searchTags, commentQuestion,
 * hashtags, topic } for `profile` — `maxWords` tightens the length for the
 * one rewrite when a story runs too long for a Short.
 */
async function writeShortStory(profile, { now = new Date(), maxWords, look } = {}) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const language = LANGUAGES[profile.language] || LANGUAGES.en;
  const niche = profile.niche === 'custom' ? null : profile.niche;
  const brief = niche ? NICHES[niche] || NICHES.motivation : `a story for this channel: ${String(profile.customNiche || '').slice(0, 300)}`;

  let topic = null;
  let topicLine = '';
  let trends = { searches: [], trending: [] };
  if (niche === 'devotional') {
    topic = devotionalTopic(now);
    if (topic.deity) {
      topicLine = ` Retell this well-known katha of ${topic.deity.name} (${topic.deity.hindi}): "${topic.deity.katha}". ` +
        'Stay faithful to the traditional version from the Puranas / Ramayana / Mahabharata — no invented characters.';
    }
    if (topic.occasion) topicLine += ` ${occasionPhrase(topic.occasion, topic.date)} — centre the story on it.`;
    trends = await devotionalTrends([topic.deity && `${topic.deity.hindi} की कथा`, topic.deity?.hindi, topic.occasion?.name]);
  }
  const searchLine = trends.searches.length
    ? ` People are searching YouTube right now for: ${trends.searches.map((q) => `"${q}"`).join(', ')}. Use the one or two ` +
      'phrases that truly describe this story in socialTitle and description, and draw searchTags from them — never other ' +
      'singers\', channels\' or regions\' names.'
    : '';
  const words = maxWords ? `${maxWords - 40}-${maxWords}` : '280-340';

  const sys =
    `You write stories for short narrated videos (YouTube Shorts / Reels). Write ${brief}.${topicLine}${searchLine} ` +
    `The first two sentences must be a gripping hook — ${look?.hook || 'the most astonishing moment or a question the viewer must have answered'}. ` +
    `Write in ${language}. Reply with JSON only: {"title":"max 60 chars","socialTitle":"a curiosity-hook title for ` +
    'Shorts/Reels in the same language, max 70 chars, starting with one fitting emoji","description":"one or two sentences",' +
    `"text":"${words} words, spoken style, no markdown — a COMPLETE story with a clear beginning, middle and ending; never stop ` +
    'mid-story","searchTags":["8-12 short search tags"],"commentQuestion":"one warm question inviting viewers to reply, max 120 ' +
    'chars"}.';
  const user = topic?.deity ? `Tell the katha: ${topic.deity.katha}.` : `Write today's story. (${now.toISOString().slice(0, 10)})`;

  const d = await ask(groq, sys, user, 6500);
  if (!d.title || !d.text || String(d.text).trim().length < 50) throw new Error('the model returned no story text');
  return {
    title: String(d.title).trim().slice(0, 70),
    socialTitle: String(d.socialTitle || d.title).trim().slice(0, 80),
    description: String(d.description || '').trim().slice(0, 300),
    text: String(d.text).trim(),
    searchTags: Array.isArray(d.searchTags) ? d.searchTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [],
    commentQuestion: d.commentQuestion ? String(d.commentQuestion).trim().slice(0, 200) : null,
    hashtags: [...(topic?.deity?.hashtags || []), topic?.occasion?.hashtag].filter(Boolean),
    topic,
  };
}

module.exports = { writeShortStory, NICHES, LANGUAGES };
