// Self-check for crawler identification and the server-side referrer rule.
// Run: node src/lib/bots.test.mjs
import assert from 'node:assert/strict';

// Mirrors BOT_UA + NAMED_BOTS + botName() in middleware.ts.
const BOT_UA = /bot|crawl|spider|googlebot|bingbot|facebookexternalhit|slurp|duckduckbot/i;
const NAMED_BOTS = [
  [/GPTBot/i, 'ChatGPT'],
  [/OAI-SearchBot|ChatGPT-User/i, 'ChatGPT Search'],
  [/PerplexityBot|Perplexity-User/i, 'Perplexity'],
  [/ClaudeBot|Claude-User|anthropic-ai/i, 'Claude'],
  [/Google-Extended/i, 'Google AI'],
  [/Googlebot/i, 'Googlebot'],
  [/bingbot|BingPreview/i, 'Bingbot'],
  [/Applebot/i, 'Applebot'],
  [/facebookexternalhit|meta-externalagent/i, 'Facebook'],
  [/Bytespider/i, 'Bytespider'],
];
function botName(ua) {
  for (const [re, name] of NAMED_BOTS) if (re.test(ua)) return name;
  return BOT_UA.test(ua) ? 'Other bot' : '';
}

// Real crawler user-agents must be named, not lumped together — the point is to
// see how often AI search reads the site.
assert.equal(botName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'), 'ChatGPT');
assert.equal(botName('Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)'), 'ChatGPT Search');
assert.equal(botName('Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'), 'Perplexity');
assert.equal(botName('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'), 'Claude');
assert.equal(botName('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), 'Googlebot');
assert.equal(botName('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'), 'Bingbot');
assert.equal(botName('facebookexternalhit/1.1'), 'Facebook');
// Ordering matters: Google-Extended must not be swallowed by the Googlebot rule.
assert.equal(botName('Mozilla/5.0 (compatible; Google-Extended/1.0)'), 'Google AI');
// Anything matching the generic rule is still flagged, just unnamed.
assert.equal(botName('SomeRandomCrawler/3.0'), 'Other bot');
assert.equal(botName('unknown-spider/1.0'), 'Other bot');

// Real browsers must never be flagged — a false positive silently deletes a real
// person from the funnel.
const HUMANS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
];
for (const ua of HUMANS) assert.equal(botName(ua), '', `must not flag a browser: ${ua.slice(0, 40)}…`);
assert.equal(botName(''), '', 'a missing user-agent is not evidence of a bot');

// Mirrors the middleware Referer rule: off-site only, malformed treated as absent.
function offsiteReferrer(ref, host) {
  try {
    const r = new URL(ref);
    if (/^https?:$/.test(r.protocol) && r.host && r.host !== host) return ref;
  } catch { /* malformed */ }
  return '';
}
assert.equal(offsiteReferrer('https://www.instagram.com/p/x', 'www.mirkash.com'), 'https://www.instagram.com/p/x');
// Our own pages are not an acquisition source — that's how the field gets polluted.
assert.equal(offsiteReferrer('https://www.mirkash.com/products/tote', 'www.mirkash.com'), '');
assert.equal(offsiteReferrer('', 'www.mirkash.com'), '');
assert.equal(offsiteReferrer('javascript:alert(1)', 'www.mirkash.com'), '', 'no host, so nothing to record');
assert.equal(offsiteReferrer('not a url', 'www.mirkash.com'), '', 'malformed degrades to empty');

console.log('bots self-check: all assertions passed');
