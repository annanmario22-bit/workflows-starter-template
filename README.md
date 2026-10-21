# Cosmos Video Server

A small server plus a phone-friendly web app for
[WaveSpeed AI Cosmos Predict 2.5 text-to-video](https://wavespeed.ai/models/wavespeed-ai/cosmos-predict-2.5/text-to-video).
It runs on Cloudflare Workers, which has a free plan.

- Your WaveSpeed API key stays on the server and never reaches the phone.
- The app asks for a password, so strangers who find the URL can't spend your credits.
- Type a prompt, tap **Generate video**, and the video appears when it's ready. Your past videos are kept on the phone.
- You can add it to your home screen and it opens like an app.

Each video costs about $0.25 on your WaveSpeed account.

## Set it up (no computer needed)

1. Get an API key at https://wavespeed.ai/accesskey and add credit to your WaveSpeed account.
2. Sign in at https://dash.cloudflare.com (a free account is enough).
3. Go to **Workers & Pages → Create → Import a repository**, connect GitHub and pick this repository.
   Leave the build settings as they are: the build command is `npm run build` and the deploy command is `npx wrangler deploy`.
4. After the first deploy, open the Worker and go to **Settings → Variables and Secrets**. Add two **Secrets**:
   - `WAVESPEED_API_KEY`: your WaveSpeed key
   - `ACCESS_PASSWORD`: a long password you make up
5. Open the `https://cosmos-video-server.<your-subdomain>.workers.dev` URL on your phone and enter the password.
6. To add it to your home screen:
   - On iPhone, tap Share → **Add to Home Screen**.
   - On Android, tap the ⋮ menu → **Add to Home screen**.

## Set it up from a computer

```bash
npm install
npx wrangler login
npx wrangler secret put WAVESPEED_API_KEY
npx wrangler secret put ACCESS_PASSWORD
npm run deploy
```

To work on it locally, copy `.dev.vars.example` to `.dev.vars`, fill it in and run `npm run dev`.

## API

Every request needs the header `Authorization: Bearer <ACCESS_PASSWORD>`.

| Route | What it does |
| --- | --- |
| `POST /api/generate` with `{"prompt": "..."}` | Starts a video. Returns `{ id, status }`. |
| `GET /api/result/:id` | Returns `{ id, status, outputs, error }`. `outputs[0]` holds the video URL once `status` is `completed`. |
| `POST /api/auth` | Checks the password without spending credit. |

## Tests

```bash
npm run build && npm test
```
