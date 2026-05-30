# Supabase setup

One-time steps to run in your Supabase project before the app will work.

## 1. Tables

Open **SQL Editor → New query**, paste the contents of [`schema.sql`](./schema.sql),
and click **Run**. Creates `users` and `properties` tables (jsonb-backed).

## 2. Storage bucket

Open **Storage → Create bucket**:

- **Name**: `media`
- **Public**: ✅ Yes (files are served by `<img>` / `<video>` tags; bucket paths
  use unguessable UUIDs so this is fine for the testers-only soft launch)
- **File size limit**: leave default (50 MB is plenty for our MP4s; you can raise
  it to 500 MB if you later use higher resolutions)
- Other options: defaults

Click **Save**.

That's it — the app reads `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`SUPABASE_BUCKET` (defaults to `media`) from `.env.local` to talk to the project.

## What's in the bucket

```
properties/{propertyId}/raw/{uuid}.jpg     uploaded property photos
properties/{propertyId}/clips/{shotId}.mp4 rendered shot clips
properties/{propertyId}/audio/{sceneId}.mp3 scene voiceovers
properties/{propertyId}/final/final-*.mp4   produced videos
_branding/outro-voice.mp3                  cached brand outro VO (shared)
```
