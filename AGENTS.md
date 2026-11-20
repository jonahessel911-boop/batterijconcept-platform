<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Batterijconcept — agent-ingang

Dit is het CRM van Batterijconcept (thuisbatterijen, Warmtefonds + eigen middelen).

1. Lees `docs/OVERDRACHT.md` voordat je status, facturen, WF of portals aanpast.
2. Domeinregels staan in `.cursor/rules/platform.mdc`.
3. Productie-DB is gedeeld met lokale `next dev`. Niet “even” statussen of facturen in de DB zetten zonder vraag.
4. Deploy = commit + push `main` naar Vercel, **alleen na expliciete ja**.

