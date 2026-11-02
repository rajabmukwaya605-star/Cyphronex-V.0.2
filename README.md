# Cyphronex-Bluevane

Encrypted messenger as an installable web app. Flat folder, no build step.

| Page | File |
|---|---|
| Chats (1:1, end-to-end encrypted) | `chats.html` |
| Groups | `groups.html` |
| Channels (admins post, members read) | `channels.html` |
| Status (24-hour updates, text or photo) | `statuses.html` |
| Profile, themes, backend, install | `profile.html` |

Shared code: `app.js`, `styles.css`, `config.js`. PWA: `manifest.webmanifest`, `sw.js`, icons. Database: `schema.sql`.

## Run it now (demo mode)
Serve the folder over HTTP (service workers need `localhost` or HTTPS):

    python3 -m http.server 8000     # then open http://localhost:8000

With no Supabase configured, the app runs on seeded demo data stored in the browser.

## Connect Supabase
1. Create a project at supabase.com.
2. SQL Editor: paste and run `schema.sql` (tables, security policies, realtime, storage buckets).
3. Project Settings > API: copy the **Project URL** (`https://<ref>.supabase.co`, without `/rest/v1`) and the **anon / publishable key**.
4. Put them in `config.js`, or open **Profile > Backend** and paste them there, then press Connect.
5. Authentication > URL Configuration: add your deployed site URL. For quick testing, turn off "Confirm email".

## Deploy and install
Upload the folder to any static HTTPS host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, Firebase Hosting).
- Chrome, Edge, Android: **Install** button on the Profile page (or the browser's install icon).
- iPhone/iPad: Share > Add to Home Screen.
- Windows, macOS, Linux, ChromeOS: install from Chrome or Edge.

## Features
- Edit profile: display name, bio, status, photo.
- Share files in any chat, group or channel (images show inline).
- Themes: 7 presets plus a custom accent, light/dark surfaces and bubble shape; saved to your profile.
- Realtime messages and statuses via Supabase.

## Security notes
- Direct chats are encrypted in the browser (ECDH P-256 key agreement, AES-256-GCM). The private key lives in this browser's storage, so a new device or cleared browser data can't read older messages.
- Group and channel messages, statuses and file attachments are **not** end-to-end encrypted. They are protected by row-level security and TLS.
- Storage buckets are public-read; files use unguessable paths. Don't share sensitive documents through them.
- Never put a `service_role` key in this app; only the anon/publishable key.
