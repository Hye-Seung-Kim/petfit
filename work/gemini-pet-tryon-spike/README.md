# Gemini pet virtual try-on feasibility spike

## Verdict: PARTIAL

The API and prompt workflow are implementable as a standalone Python script, but visual feasibility was **not validated in this environment**: neither `GEMINI_API_KEY`/`GOOGLE_API_KEY` nor an approved user-provided dog image was available. The script, three prompt strategies, three outfit presets, evaluation sheet, retry handling, and explicit demo fallback are ready. The recommendation below is documentation- and failure-mode-based, not the result of scored generations.

This is a creative style preview. It is **not a physical sizing, safety, or fit guarantee**.

## Model decision

**Recommended default:** `gemini-3.1-flash-image` (Nano Banana 2).

Google describes this GA model as high-quality native image generation and conversational editing at low latency, optimized for speed and high-volume use. It supports image input and image output, and its improved consistency makes it the safer fast-model choice when dog identity matters.

**Faster optional experiment:** `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite). Google targets sub-2-second end-to-end latency for this model, but it is the efficiency tier and is limited to 1K output. Test it only after the default is scored; switch only if its preservation quality clears the same demo gate.

`gemini-2.5-flash-image` is still listed, but it is the previous-generation image model and is not the recommended starting point for a new spike.

Authoritative references (checked 2026-09-12):

- [Nano Banana image generation and editing](https://ai.google.dev/gemini-api/docs/image-generation)
- [`gemini-3.1-flash-image` model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image)
- [`gemini-3.1-flash-lite-image` model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image)

## Files

```text
work/gemini-pet-tryon-spike/
├── README.md
├── run-example.py
├── prompts.md
├── evaluation.md
├── inputs/
│   └── README.md
└── outputs/
    └── README.md
```

## Setup

Python 3.10+ is recommended.

```bash
cd work/gemini-pet-tryon-spike
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U google-genai
export GEMINI_API_KEY='set this in the shell or a secret manager'
```

### Required environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `GEMINI_API_KEY` | Yes for API calls | Google Gemini API credential. Never place it in this directory or metadata. |
| `GEMINI_IMAGE_MODEL` | No | Overrides the default model, for example `gemini-3.1-flash-lite-image`. |

The script deliberately requires `GEMINI_API_KEY`; it does not silently select unrelated Google Cloud credentials. `--print-prompt` requires no credential.

## Inputs

Put a user-owned, user-created, or explicitly licensed dog image at `inputs/user-dog.jpg`. Optionally put an approved garment image at `inputs/user-outfit-reference.png`. PNG, JPEG, and WebP are accepted.

Best expected input conditions:

- one dog, sharply focused, with face and torso fully visible;
- front three-quarter or side view where garment boundaries are obvious;
- paws, ears, and tail visible rather than cropped or hidden;
- moderate, even lighting and a simple static background;
- enough resolution to distinguish eyes, muzzle, and fur markings;
- no existing clothing, harness, leash, or heavy torso occlusion;
- for an outfit reference, a garment-only/product view with no model, logo, or text;
- a reference whose viewing angle and garment proportions roughly match the dog pose.

Avoid low-resolution images, motion blur, multiple animals, dense foliage crossing the body, extreme foreshortening, and long fur that makes the torso boundary ambiguous.

## Run

Recommended strategy and default model:

```bash
python run-example.py \
  --dog inputs/user-dog.jpg \
  --outfit "red hoodie" \
  --strategy negative \
  --output outputs/red-hoodie.png
```

With an optional outfit reference:

```bash
python run-example.py \
  --dog inputs/user-dog.jpg \
  --outfit-reference inputs/user-outfit-reference.png \
  --outfit "yellow raincoat" \
  --strategy negative \
  --output outputs/yellow-raincoat.png
```

Other prepared outfit names are `formal black tuxedo`, `yellow raincoat`, and `red hoodie`. Any free-form outfit description is accepted. Inspect a resolved prompt without an API call:

```bash
python run-example.py --outfit "formal black tuxedo" --strategy negative --print-prompt
```

See [`prompts.md`](prompts.md) for the controlled nine-run comparison and the complete recommended prompt.

## Request format

The script uses the official `google-genai` Python SDK and calls:

```python
client.models.generate_content(
    model="gemini-3.1-flash-image",
    contents=[types.Content(role="user", parts=[
        types.Part.from_text(text="SOURCE DOG IMAGE ..."),
        types.Part.from_bytes(data=dog_bytes, mime_type="image/jpeg"),
        # Optional label + outfit-reference image are inserted here.
        types.Part.from_text(text=prompt),
    ])],
    config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
)
```

The source dog is the first image. An optional reference is the second image and is labeled as garment cues only. Image-only response modality reduces the chance of receiving explanatory text instead of the requested artifact. The API may still return no image because of safety handling or a malformed/unsupported request; that is treated as an error.

## Output handling

- The first returned inline image is saved under `outputs/`.
- The file suffix is changed to match the returned MIME type (`.png`, `.jpg`, or `.webp`) rather than writing mislabeled bytes.
- An adjacent `<image>.<ext>.json` records model, strategy, prompt, input basenames, MIME type, UTC time, and measured end-to-end request latency.
- API keys and input image bytes are never written to metadata.
- Existing output paths are overwritten only when the same command/path is explicitly reused; use distinct names for comparisons.
- Gemini-generated images include Google's SynthID watermarking; do not claim the output is an unmodified photograph.

## Latency

No latency was observed because no authenticated request could be made.

- Google publishes a **sub-2-second target** for `gemini-3.1-flash-lite-image` at 1K.
- Google describes `gemini-3.1-flash-image` as low latency but does not publish a fixed end-to-end SLA on the cited model page.
- For demo engineering, allow a **120-second request envelope** and show visible progress. An initial product budget of roughly **5–30 seconds** for the default model is a planning estimate only, not a measured or vendor-guaranteed range. Replace it with p50/p95 measurements from the actual region/account and representative inputs.

The script records actual latency for every successful request.

## Expected visual failure modes

1. **Identity drift:** changed muzzle, eyes, expression, ear shape, apparent age, or breed.
2. **Fur drift:** markings disappear, shift, or get repainted near garment boundaries.
3. **Anatomy errors:** extra/missing paws or legs, merged limbs, altered body silhouette, displaced tail.
4. **Garment geometry errors:** floating fabric, fused fur/fabric, impossible sleeves, bad straps, bow tie on the muzzle, hood covering ears.
5. **Scene drift:** changed crop, camera angle, background objects, color grade, depth of field, or lighting.
6. **Reference leakage:** wearer/body/background/text/logo from the outfit reference appears in the result.
7. **Over-styling:** illustration-like rendering, beauty retouching, or a fully regenerated scene.
8. **Format failures:** text-only response, no image, wrong aspect behavior, or more than one composition/collage.

Gemini editing is generative, not deterministic pixel-level inpainting. Prompting can reduce these failures but cannot guarantee identity preservation.

## Retry guidance

The script defaults to three attempts with exponential backoff plus jitter for HTTP 429 and transient 5xx/unavailable/deadline errors.

- Retry 429/500/502/503/504 up to three times.
- Respect provider retry hints if surfaced by the deployment.
- Do not automatically retry authentication, invalid request, unsupported image, policy, or other non-transient 4xx errors.
- A no-image response should be surfaced. One deliberate retry with Strategy C or a simpler garment is reasonable, but do not loop until a visually convenient result appears.
- On visual failure, keep the same source and simplify the outfit before changing identity constraints. Do not automatically show a previous/mock image as though it were the new API result.
- Log model, strategy, latency, and a safe request ID if available; never log the key or full user image.

## Safe fallback / Demo Mode

For the main demo, prevalidate exactly:

1. one approved dog input with a clear face, torso, paws, and tail;
2. one simple outfit—start with the **plain red hoodie**, hood behind the neck, no logo;
3. one stored output generated from that exact pair and manually accepted using `evaluation.md`;
4. a prominent **Demo Mode — pre-generated preview** indicator.

Real API and Demo Mode must be separate explicit paths. If the real call fails, show the error and offer a user-selected “View pre-generated Demo Mode example” action. **Never silently fall back** to the stored result, and never imply the stored dog/outfit corresponds to the user's upload.

## Recommendation for the main implementation

Copy only these concepts; do not copy the spike wholesale into production:

- model ID: `gemini-3.1-flash-image`, configurable by environment;
- Strategy C prompt and the three outfit descriptions from `prompts.md`;
- content ordering/labels: source dog first, optional outfit reference second, prompt last;
- image-only response handling and MIME-aware file storage;
- three-attempt transient-only backoff policy;
- safe metadata fields and measured latency;
- six-dimension qualitative demo gate from `evaluation.md`;
- explicit, opt-in Demo Mode behavior above;
- user-facing disclaimer: “Creative style preview—not a physical sizing or fit guarantee.”

Do **not** copy credentials, generated images without permissions, spike-local paths, or any behavior that silently substitutes mock output.

## What remains to validate

1. Add a permitted dog image and credential.
2. Run all nine strategy/outfit combinations in `prompts.md`.
3. Score every output in `evaluation.md` without cherry-picking.
4. Repeat the strongest condition three times to assess consistency.
5. Compare the default against `gemini-3.1-flash-lite-image` on the same input.
6. Replace planning latency with observed p50/p95 and retain one licensed, prevalidated demo pair/result.
