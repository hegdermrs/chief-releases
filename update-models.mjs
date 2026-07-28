/**
 * Refreshes models.json automatically (daily GitHub Action).
 *
 * openai: GET api.openai.com/v1/models with OPENAI_API_KEY — chat-class
 *   gpt models newer than the curated lineup are prepended. Without the
 *   secret (or on any error) the section is left untouched.
 * claude: same idea against api.anthropic.com with ANTHROPIC_API_KEY —
 *   optional; this list is only the app's fallback (installs query
 *   Anthropic live themselves).
 *
 * Mirrors the merge rules shipped inside the app (modelCatalog.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'models.json';

const CURATED_OPENAI = [
  { id: 'gpt-5.6-sol', label: 'Sol' },
  { id: 'gpt-5.6-terra', label: 'Terra' },
  { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
  { id: 'gpt-5.6-luna', label: 'Luna' },
];
const CURATED_CLAUDE = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

// Not chat models / dated snapshots — never picker material.
const OPENAI_EXCLUDE = /(audio|realtime|image|embed|moderation|transcribe|tts|search|instruct|distill)|-\d{4}(-\d{2}){0,2}$/;

const labelFromOpenaiId = id => {
  const last = id.split('-').at(-1) ?? id;
  if (/^[a-z]+$/i.test(last)) return last[0].toUpperCase() + last.slice(1);
  return 'GPT-' + id.replace(/^gpt-/, '');
};

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function mergeNewest(curated, rows, { idOk, createdOf, labelOf }) {
  const curatedIds = new Set(curated.map(m => m.id));
  const newestKnown = Math.max(0, ...rows.filter(m => curatedIds.has(m.id)).map(createdOf));
  const fresh = rows
    .filter(m => idOk(m.id) && !curatedIds.has(m.id) && createdOf(m) > newestKnown)
    .sort((a, b) => createdOf(b) - createdOf(a))
    .slice(0, 4)
    .map(m => ({ id: m.id, label: labelOf(m) }));
  return [...fresh, ...curated];
}

const doc = JSON.parse(readFileSync(FILE, 'utf-8'));

if (process.env.OPENAI_API_KEY) {
  try {
    const { data } = await fetchJson('https://api.openai.com/v1/models', {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    });
    doc.openai = mergeNewest(CURATED_OPENAI, data ?? [], {
      idOk: id => /^gpt-\d/.test(id) && !OPENAI_EXCLUDE.test(id),
      createdOf: m => m.created ?? 0,
      labelOf: m => labelFromOpenaiId(m.id),
    });
    console.log('openai refreshed:', doc.openai.map(m => m.id).join(', '));
  } catch (err) {
    console.log('openai refresh skipped:', String(err));
  }
} else {
  console.log('openai refresh skipped: no OPENAI_API_KEY secret');
}

if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { data } = await fetchJson('https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    });
    doc.claude = mergeNewest(CURATED_CLAUDE, data ?? [], {
      idOk: id => id.startsWith('claude'),
      createdOf: m => Date.parse(m.created_at ?? '') || 0,
      labelOf: m => (m.display_name ?? m.id).replace(/^Claude\s+/i, ''),
    });
    console.log('claude refreshed:', doc.claude.map(m => m.id).join(', '));
  } catch (err) {
    console.log('claude refresh skipped:', String(err));
  }
} else {
  console.log('claude refresh skipped: no ANTHROPIC_API_KEY secret (installs query Anthropic live anyway)');
}

writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
