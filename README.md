# property

AI-powered TikTok/Reels-format real-estate listing video generator.

Drop property photos → an AI agent scores and orders them → an AI director writes
a script-first beat sheet of multi-shot scenes → renderers turn photos into
landscape AI clips (fal.ai LTX-2 / Veo) or Ken Burns clips (local FFmpeg) →
compositor wraps each scene with a kinetic word-by-word voiceover caption synced
to the narration and a hardcoded Esperanza outro card.

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind v4
- Supabase Postgres (`users`, `properties` jsonb) + Storage (`media` bucket)
- OpenAI gpt-4o-mini for vision scoring and the director
- fal.ai for AI video (LTX-2-19B distilled by default, Veo 3.1 switchable)
- Edge TTS for voiceover (free, with word-boundary timing → kinetic captions)
- FFmpeg via `ffmpeg-static` for Ken Burns, cropping, and compositing

## Setup

1. Apply [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor.
2. Create a **public** Storage bucket named `media`.
3. Fill `.env.local`:
   - `OPENAI_API_KEY`
   - `FAL_KEY`
   - `GEMINI_API_KEY` (fallback)
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` (server-only)
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_BUCKET=media`
4. `npm install && npm run dev`

## Hosting note

The produce step (AI clip rendering + multi-pass FFmpeg compositing) runs for
minutes per video — well beyond serverless function timeouts. Deploy on a host
with long-running processes and bundled-binary support: Render Web Service, Fly
machine, Railway, or a VPS. Vercel can serve the UI and light API but cannot run
produce end-to-end.
