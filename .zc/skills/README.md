# 9Router — Agent Skills

## Language and Coding Standards
- **Communication**: Always talk in Thai when interacting with users.
- **Code & Technical Assets**: All code, comments, documentation, and technical definitions must be in English.

Drop-in skills for any AI agent (zAICoder, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use 9Router for you.

> Tip: start with the **zaicoder** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder-web-fetch/SKILL.md |

## How to use

Paste to your AI (zAICoder, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/decolua/zaicoder/refs/heads/master/skills/zaicoder/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export NINEROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireAzaicoderKey=true)
```

Verify: `curl $NINEROUTER_URL/azaicoder/health` → `{"ok":true}`.

## Links

- Source: https://github.com/decolua/zaicoder
- Dashboard: https://zaicoder.com
