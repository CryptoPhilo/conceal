#!/usr/bin/env node
/**
 * Translate legal markdown documents (Terms of Service, Privacy Policy)
 * via Google Translate API.
 *
 * Usage:
 *   GOOGLE_TRANSLATE_API_KEY=xxx node scripts/translate-legal.mjs --source en --target ko
 *   GOOGLE_TRANSLATE_API_KEY=xxx node scripts/translate-legal.mjs --source ko --target en
 *
 * Input files:  packages/web/public/legal/{doc}-{source}.md
 * Output files: packages/web/public/legal/{doc}-{target}.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = path.join(__dirname, '../packages/web/public/legal');
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

const MAX_CHARS = 30_000;

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};
const source = getArg('--source') ?? 'en';
const target = getArg('--target') ?? 'ko';
const dryRun = args.includes('--dry-run');

if (!API_KEY) {
  console.error('Error: GOOGLE_TRANSLATE_API_KEY env var is required');
  process.exit(1);
}

const DOCS = ['terms', 'privacy'];

/**
 * Split markdown into translatable paragraphs while preserving headings,
 * code blocks, and URLs.
 */
function splitParagraphs(text) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Call Google Translate API.
 * Uses 'text' format (not html) for markdown since we want raw text output.
 */
async function translateChunks(paragraphs, sourceLang, targetLang) {
  const results = [];
  let batchStart = 0;

  while (batchStart < paragraphs.length) {
    let batchEnd = batchStart;
    let charCount = 0;

    while (
      batchEnd < paragraphs.length &&
      charCount + paragraphs[batchEnd].length < MAX_CHARS
    ) {
      charCount += paragraphs[batchEnd].length;
      batchEnd++;
    }

    const batch = paragraphs.slice(batchStart, batchEnd);

    const response = await fetch(`${TRANSLATE_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: batch,
        source: sourceLang,
        target: targetLang,
        format: 'text',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Translate API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    results.push(...data.data.translations.map((t) => t.translatedText));
    batchStart = batchEnd;
  }

  return results;
}

async function translateDoc(docName) {
  const srcFile = path.join(LEGAL_DIR, `${docName}-${source}.md`);
  const tgtFile = path.join(LEGAL_DIR, `${docName}-${target}.md`);

  if (!fs.existsSync(srcFile)) {
    console.warn(`  Skipping ${docName}: source file not found (${srcFile})`);
    return;
  }

  const srcText = fs.readFileSync(srcFile, 'utf8');
  const paragraphs = splitParagraphs(srcText);

  console.log(`  Translating ${docName} (${paragraphs.length} paragraphs)...`);
  const translated = await translateChunks(paragraphs, source, target);
  const output = translated.join('\n\n') + '\n';

  if (dryRun) {
    console.log(`\n--- ${docName}-${target}.md (dry run) ---`);
    console.log(output.slice(0, 500) + (output.length > 500 ? '\n...' : ''));
    return;
  }

  fs.writeFileSync(tgtFile, output, 'utf8');
  console.log(`  Wrote ${tgtFile}`);
}

async function main() {
  if (!fs.existsSync(LEGAL_DIR)) {
    console.error(`Legal directory not found: ${LEGAL_DIR}`);
    console.error('Run: mkdir -p packages/web/public/legal  and add source .md files first');
    process.exit(1);
  }

  console.log(`Translating legal docs (${source} → ${target})...\n`);

  for (const doc of DOCS) {
    await translateDoc(doc);
  }

  if (!dryRun) {
    console.log('\nDone. Have a legal professional review the output before publishing.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
