# @framefields/ai

AI models (images, video, music, sound effects, voice, upscaling, background removal) through the framefields AI gateway, billed to your framefields account. No dependencies. Use it from the main package:

```ts
import { ai } from "framefields";

// FRAMEFIELDS_API_KEY from the environment, or:
ai.config({ apiKey: process.env.FRAMEFIELDS_API_KEY });

const { data } = await ai.subscribe<{ images: { url: string }[] }>("flux/schnell", {
  input: { prompt: "Neon street at night" },
});
console.log(data.images[0].url);
```

| Method | Use |
| --- | --- |
| `ai.run(model, { input })` | One request; best for fast models. |
| `ai.subscribe(model, { input, onQueueUpdate, logs })` | Queues the job, polls, returns the output. Use for video and music. |
| `ai.stream(model, { input })` | Iterate partial output; `await stream.done()` for the last. |
| `ai.queue.submit / status / result / cancel` | Run many jobs and collect them later by `requestId`. |
| `ai.storage.upload(blob)` | Upload a local file and pass the URL as input. `Blob`s inside `input` upload automatically. |

Failed calls throw `ApiError` (`status`, `type`, `body`, `requestId`), or `ValidationError` with `fieldErrors` when the input doesn't match the model's schema. `type` is the gateway's code, e.g. `insufficient_credits` (top up at https://framefields.dev/dashboard/billing) or `rate_limited`.

Model ids and their input schemas: https://framefields.dev/models. Keys: https://framefields.dev/dashboard/keys.

`FRAMEFIELDS_AI_PROXY_URL` overrides the gateway URL, for running the gateway locally.
