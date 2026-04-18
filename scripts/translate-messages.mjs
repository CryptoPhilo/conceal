#!/usr/bin/env node
/**
 * Auto-translate next-intl JSON message files via Google Translate API.
 *
 * Usage:
 *   GOOGLE_TRANSLATE_API_KEY=xxx node scripts/translate-messages.mjs --source en --target ko
 *   GOOGLE_TRANSLATE_API_KEY=xxx node scripts/translate-messages.mjs --source ko --target en
 *
 * Flags:
 *   --source  Source locale (default: en)
 *   --target  Target locale (default: ko)
 *   --dry-run Print diff without writing
 *   --force   Overwrite keys that already exist in target (default: skip existing)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = path.join(__dirname, '../packages/web/messages');
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

// Batch limits per Google Translate API v2 docs
const MAX_BATCH = 128;
const MAX_CHARS = 30_000;

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};
const source = getArg('--source') ?? 'en';
const target = getArg('--target') ?? 'ko';
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

if (!API_KEY) {
  console.error('Error: GOOGLE_TRANSLATE_API_KEY env var is required');
  process.exit(1);
}

if (source === target) {
  console.error('Error: --source and --target must differ');
  process.exit(1);
}

/**
 * Flatten nested object into { 'a.b.c': value } map.
 * Arrays become 'a.0', 'a.1', etc.
 */
function flatten(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      result[key] = v;
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'string') {
          result[`${key}.${i}`] = item;
        } else if (typeof item === 'object' && item !== null) {
          Object.assign(result, flatten(item, `${key}.${i}`));
        }
      });
    } else if (typeof v === 'object' && v !== null) {
      Object.assign(result, flatten(v, key));
    }
  }
  return result;
}

/**
 * Set nested value by dot-path key.
 */
function setDeep(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const nextIsArray = /^\d+$/.test(nextPart);
    if (cur[part] === undefined) {
      cur[part] = nextIsArray ? [] : {};
    }
    cur = cur[part];
  }
  const last = parts[parts.length - 1];
  cur[last] = value;
}

/**
 * Protect next-intl placeholders like {count} from translation.
 * Replaces with <ph id="N"/> tags, restores after.
 */
function protectPlaceholders(text) {
  const placeholders = [];
  const protected_ = text.replace(/\{[^}]+\}/g, (match) => {
    const id = placeholders.length;
    placeholders.push(match);
    return `<ph id="${id}"/>`;
  });
  return { protected: protected_, placeholders };
}

function restorePlaceholders(text, placeholders) {
  return text.replace(/<ph id="(\d+)"\/>/g, (_, id) => placeholders[parseInt(id)] ?? _);
}

/**
 * Call Google Translate API for a batch of strings.
 */
async function translateBatch(texts, sourceLang, targetLang) {
  const response = await fetch(`${TRANSLATE_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: texts,
      source: sourceLang,
      target: targetLang,
      format: 'html',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Translate API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.data.translations.map((t) => t.translatedText);
}

/**
 * Translate all strings in the map, respecting batch limits.
 */
async function translateAll(entries, sourceLang, targetLang) {
  // entries: [{ key, protected, placeholders }]
  const results = new Array(entries.length);
  let batchStart = 0;

  while (batchStart < entries.length) {
    let batchEnd = batchStart;
    let charCount = 0;

    while (
      batchEnd < entries.length &&
      batchEnd - batchStart < MAX_BATCH &&
      charCount + entries[batchEnd].protected.length < MAX_CHARS
    ) {
      charCount += entries[batchEnd].protected.length;
      batchEnd++;
    }

    const batch = entries.slice(batchStart, batchEnd);
    const translated = await translateBatch(
      batch.map((e) => e.protected),
      sourceLang,
      targetLang
    );

    batch.forEach((entry, i) => {
      results[batchStart + i] = restorePlaceholders(translated[i], entry.placeholders);
    });

    batchStart = batchEnd;
    process.stdout.write(`  Translated ${Math.min(batchEnd, entries.length)}/${entries.length} strings...\r`);
  }

  console.log('');
  return results;
}

async function main() {
  const srcFile = path.join(MESSAGES_DIR, `${source}.json`);
  const tgtFile = path.join(MESSAGES_DIR, `${target}.json`);

  if (!fs.existsSync(srcFile)) {
    console.error(`Source file not found: ${srcFile}`);
    process.exit(1);
  }

  const srcJson = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  const tgtJson = fs.existsSync(tgtFile) ? JSON.parse(fs.readFileSync(tgtFile, 'utf8')) : {};

  const srcFlat = flatten(srcJson);
  const tgtFlat = flatten(tgtJson);

  // Determine which keys need translation
  const keysToTranslate = force
    ? Object.keys(srcFlat)
    : Object.keys(srcFlat).filter((k) => !(k in tgtFlat));

  if (keysToTranslate.length === 0) {
    console.log(`All ${Object.keys(srcFlat).length} keys already translated in ${target}.json. Use --force to re-translate.`);
    return;
  }

  console.log(`Translating ${keysToTranslate.length} keys (${source} → ${target})...`);

  const entries = keysToTranslate.map((key) => {
    const { protected: prot, placeholders } = protectPlaceholders(srcFlat[key]);
    return { key, protected: prot, placeholders };
  });

  const translations = await translateAll(entries, source, target);

  // Build updated target JSON
  const updatedTgt = JSON.parse(JSON.stringify(tgtJson));
  const added = [];

  keysToTranslate.forEach((key, i) => {
    const value = translations[i];
    if (dryRun) {
      added.push({ key, value });
    } else {
      setDeep(updatedTgt, key, value);
      added.push({ key, value });
    }
  });

  if (dryRun) {
    console.log('\nDry run — changes that would be written:');
    added.forEach(({ key, value }) => {
      console.log(`  [${key}] → ${value}`);
    });
    return;
  }

  fs.writeFileSync(tgtFile, JSON.stringify(updatedTgt, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${tgtFile}`);
  console.log(`Added/updated ${added.length} keys.`);
  console.log('\nNext step: have a native speaker review the changes before shipping.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
