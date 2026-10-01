# TikSearch API

A small TikTok search and MP4 download API built with Express, Puppeteer, stealth browsing, and `yt-dlp`.

## Endpoints

All API endpoints require either the `x-api-key` header or the `apikey` query parameter.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/` | Web landing page and service check |
| `POST` | `/keygen` | Generate a signed API key |
| `GET` | `/search?q=<query>` | Search TikTok and return structured JSON results |
| `GET` | `/download?url=<tiktok-url>` | Download one TikTok URL as MP4 |
| `GET` | `/video?q=<query>` | Search and return the first working MP4 |

Example:

```bash
curl "https://your-host.example/video?q=ronaldo%20edit" \
  -H "x-api-key: YOUR_API_KEY" \
  -o clip.mp4
```

## Run locally

Requirements:

- Node.js 20+
- Chromium/Chrome
- `yt-dlp` on `PATH`

```bash
npm ci
API_KEY=your-master-key SECRET=your-signing-secret npm start
```

The service listens on `PORT` or port `3000` by default.

## Docker / Render

The included `Dockerfile` installs Chromium, FFmpeg, and `yt-dlp`. `render.yaml` provisions `API_KEY` and `SECRET` as generated environment variables.

Do not commit real API keys or secrets. They belong in the hosting provider’s environment settings.

## Notes

- Search results are cached for 10 minutes.
- User-generated keys are limited to 40 requests per minute.
- At most two browser searches run concurrently.
- Video responses are capped at 60 MB.
