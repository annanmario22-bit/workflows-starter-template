# MOSS Image (mobile)

A phone-friendly web app for generating images with [MOSS-Image](https://openmoss.ai/MOSS-Image/), the open text-to-image model from OpenMOSS. It runs on a Cloudflare Worker that forwards requests to the official [MOSS-Image Hugging Face Space](https://huggingface.co/spaces/OpenMOSS-Team/MOSS-Image), so there is no GPU to host yourself.

Features:

- Prompt box with example ideas, aspect-ratio presets (1:1 to 16:9)
- SFT or Base model, steps, guidance, seed and negative prompt in Settings
- Recent images strip, plus Save / share through your phone's share sheet
- Installable: on iPhone use Share → Add to Home Screen; on Android, Install app

## Hugging Face token

The Space runs on ZeroGPU, which gives anonymous callers a very small quota. To generate more than a couple of images, use a free Hugging Face token ([create one here](https://huggingface.co/settings/tokens), "Read" access is enough). Either:

- paste it into the app's **Settings** (stored only in that browser), or
- set it on the Worker for everyone who uses your deployment:

```bash
npx wrangler secret put HF_TOKEN
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the token.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # run `npm run build` once first
```

## Deployment

```bash
npm run deploy
```

Then open the `*.workers.dev` URL on your phone.

## How it works

| Route | Purpose |
| --- | --- |
| `POST /api/generate` | Queues a generation on the Space's `/generated_images` endpoint |
| `GET /api/generate/:id` | Streams the Space's server-sent events until the image is ready |
| `GET /api/image?src=` | Same-origin copy of a generated image, used for saving and sharing |

MOSS-Image weights are Apache-2.0. Generated image links come from the Space and can expire after a while, so save the ones you want to keep.
