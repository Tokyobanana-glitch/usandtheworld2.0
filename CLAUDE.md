# Us and The World

A travel app at usandtheworld.com. People search any destination and get an
AI-generated itinerary where every stop is checked against a live source,
geocoded to real coordinates, and re-verified over time. That verification is
the product's reason to exist: never present a guess as a fact.

Stack: React 19 + Vite, react-router-dom, Vercel serverless functions,
Supabase (Postgres, Auth via magic link, Storage), Anthropic via Vercel AI
Gateway. Installable PWA.

## The app's four tabs

Explore (search hero plus editorial destination briefs), Bucket List (places
people want to go), Passport (places they've been, with photos and notes,
presented as a passport book), Travel (their itineraries and sharing).

The visual direction is modeled on the American Express Travel iOS app. Before
any UI work, read `design-reference/DESIGN_REFERENCE.md` and view the matching
screenshots in `design-reference/amex/`. When a task prompt and the design
reference disagree on visual details, the design reference wins.

## Hard rules

Never run `vercel env pull`. It overwrites the real SUPABASE_SERVICE_ROLE_KEY
in `.env.local` with a `[SENSITIVE]` placeholder.

The Vercel Hobby plan caps serverless functions at 12, and we are at exactly
12. Never add a new file under `api/` outside `api/_lib/`. Fold new server
logic into an existing endpoint (see how `geocode-place` lives inside
`api/trip-edit.js`), or read directly through Supabase with RLS.

You cannot run DDL against Supabase. Write migrations to
`supabase/00N_description.sql`, and make code degrade gracefully until the
owner applies them in the SQL Editor. Never ship code that hard-depends on an
unapplied migration. When you finish a migration, paste its full contents in
your reply so it can be copied directly, rather than only naming the file.

Anonymous search and itinerary generation must always work without sign-in.
Auth only gates saving things to an account.

Do not change the `/trip/:slug` server-rendered branch in `src/main.jsx`, the
OG image route, or the frozen-share-link guarantee. A shared trip link must
show exactly what was shared.

Generated imagery is for editorial slots only (Explore briefs, carousels,
empty states). Verified itinerary stops use real photography, because there
an image implies what the place actually looks like.

## Working style

Read the code before changing it. Match existing conventions and comment
style. Run `npm run build` and `npx oxlint src api` before calling anything
done. Verify real behavior in headless Chrome at 390px and 1280px rather than
only reading code, and clean up any test data you create. Show a diff summary
before committing, and don't push unless asked.
