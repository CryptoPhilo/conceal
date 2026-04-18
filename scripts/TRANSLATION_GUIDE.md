# Translation Guide

Conceal uses **Google Translate API** for initial machine translation followed by native speaker review before shipping.

## Setup

Add your key to `.env` (root) or export it:

```bash
GOOGLE_TRANSLATE_API_KEY=your-key-here
```

Get a key: Google Cloud Console → APIs & Services → Enable "Cloud Translation API" → Credentials → API Key.

---

## Translating UI Messages

Messages live in `packages/web/messages/`.

```bash
# Translate new English strings → Korean (skips already-translated keys)
node scripts/translate-messages.mjs --source en --target ko

# Preview without writing
node scripts/translate-messages.mjs --source en --target ko --dry-run

# Re-translate existing keys
node scripts/translate-messages.mjs --source en --target ko --force

# Reverse: Korean → English
node scripts/translate-messages.mjs --source ko --target en
```

### What it handles
- Nested JSON structure preserved
- Arrays preserved
- `{placeholder}` variables protected from translation
- Skips already-translated keys by default (incremental)

---

## Translating Legal Documents

Legal docs live in `packages/web/public/legal/`.

```bash
# Translate English legal docs → Korean
node scripts/translate-legal.mjs --source en --target ko

# Preview
node scripts/translate-legal.mjs --source en --target ko --dry-run
```

Files: `terms-en.md` / `terms-ko.md`, `privacy-en.md` / `privacy-ko.md`

---

## Native Review Workflow

Machine translation is **always** the first draft. Human review is required before publishing.

### UI Strings (messages/*.json)

1. Run the translation script
2. Open a PR with the changed `.json` file
3. Assign a native speaker reviewer (add `needs-translation-review` label)
4. Reviewer checks for:
   - Natural phrasing (not word-for-word machine translation)
   - Correct formality level (해요체 for Korean — confirmed by board)
   - Placeholder variables intact: `{count}`, `{name}`, etc.
   - Array items correctly ordered
5. Merge after approval

### Legal Documents (public/legal/*.md)

1. Run `translate-legal.mjs`
2. **Mandatory legal review** before publishing — machine translation of legal text is a starting point only
3. Legal reviewer must sign off before the file goes live

---

## Adding a New Locale

1. Add locale to `packages/web/i18n/routing.ts` (`locales` array)
2. Create source file: `packages/web/messages/{locale}.json`
3. Run: `node scripts/translate-messages.mjs --source en --target {locale}`
4. Run: `node scripts/translate-legal.mjs --source en --target {locale}`
5. Native review → merge

---

## npm Scripts

Convenience shortcuts in root `package.json`:

```bash
npm run translate:ko      # en → ko (UI messages)
npm run translate:en      # ko → en (UI messages)
npm run translate:legal   # en → ko (legal docs)
```
