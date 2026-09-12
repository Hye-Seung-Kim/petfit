# Prompt strategies

These prompts are for qualitative feasibility testing, not claims about physical sizing or fit. In the script, `<OUTFIT>` is replaced by a preset or user description. The dog image is sent first; an optional outfit reference is sent second and explicitly limited to garment cues.

## Outfit descriptions

- **red hoodie:** a plain red pet hoodie fitted around the torso, with the hood resting behind the neck and never over the head or ears; no text or logo
- **yellow raincoat:** a plain yellow waterproof pet raincoat fitted over the back and torso, with the collar below the jaw; no hood over the head, text, or logo
- **formal black tuxedo:** a formal black pet tuxedo jacket around the torso, with a white shirt front and a small black bow tie below the neck; no trousers, shoes, hat, text, or logo

## Strategy A — simple clothing addition

```text
Edit the provided dog photo so the same dog is naturally wearing <OUTFIT>. Change only the clothing area, keep the dog and scene otherwise unchanged, and return one photorealistic image.
```

**Hypothesis:** Fast and flexible, but underspecified. It is most likely to redraw the face, fur, pose, crop, or background.

## Strategy B — strict identity preservation

```text
Selected outfit: <OUTFIT>

Edit the provided dog image by adding only the selected pet outfit.

Preserve the dog's exact identity, face, breed appearance, fur color,
fur markings, ears, eyes, body position, anatomy, camera angle,
background, and lighting.

Fit the clothing naturally around the torso without covering the eyes,
nose, mouth, paws, or tail.

Do not change the breed.
Do not alter facial features.
Do not add or remove limbs.
Do not alter fur markings.
Do not add text or logos.
Do not replace the background.
Produce one photorealistic virtual pet fashion preview.
```

**Hypothesis:** Better identity retention than A, with a manageable instruction load.

## Strategy C — identity preservation plus negative constraints (recommended)

```text
Selected outfit: <OUTFIT>

Edit the provided dog image by adding only the selected pet outfit.

Preserve the dog's exact identity, face, breed appearance, fur color,
fur markings, ears, eyes, body position, anatomy, camera angle,
background, and lighting.

Fit the clothing naturally around the torso without covering the eyes,
nose, mouth, paws, or tail.

Do not change the breed.
Do not alter facial features.
Do not add or remove limbs.
Do not alter fur markings.
Do not add text or logos.
Do not replace the background.
Produce one photorealistic virtual pet fashion preview.

Treat the dog input as the immutable source image and perform a localized torso-only edit.
Keep every visible pixel outside the garment and its physically necessary edge shadows as unchanged as possible.
Do not redraw, reinterpret, beautify, age, resize, rotate, or reposition the dog.
Do not change the crop, framing, lens perspective, depth of field, exposure, color grade, shadows, or background objects.
Do not change coat texture, fur length, muzzle shape, expression, gaze, ear shape, eye color, nose, paws, legs, or tail.
Do not add collars, leashes, accessories, people, animals, props, extra garment pieces, typography, watermarks, or branding.
The garment may occlude only the torso fur that it naturally covers. Preserve visible boundary markings exactly.
Return exactly one edited photorealistic image and no collage, comparison panel, or caption.

Priority order: (1) exact dog identity and anatomy, (2) unchanged scene and composition, (3) plausible garment placement, (4) outfit styling. If the garment conflicts with identity preservation, simplify the garment rather than changing the dog.
```

When an outfit reference is supplied, append:

```text
An outfit reference image follows the dog image. Use it only for the garment's design, material, construction, and color. Never copy its wearer, body, pose, background, text, or logos. The written outfit description wins if they conflict.
```

**Why recommended:** This makes the edit locality and priority order explicit. The negative list targets the common regressions expected from generative redraws. It is a hypothesis until a licensed dog image and valid API credential are tested; no result-based winner is claimed yet.

## Comparison procedure

Use the same source image, model, outfit wording, and no reference image for the first comparison. Generate one result per strategy for each outfit (nine outputs). Do not cherry-pick seeds or silently replace failures. Then test the optional reference only with Strategy C.

```bash
for strategy in simple strict negative; do
  for outfit in "red hoodie" "yellow raincoat" "formal black tuxedo"; do
    slug=$(printf '%s-%s' "$strategy" "$outfit" | tr ' ' '-')
    python run-example.py --dog inputs/user-dog.jpg --outfit "$outfit" \
      --strategy "$strategy" --output "outputs/${slug}.png"
  done
done
```

Gemini image generation is nondeterministic. If time permits, use three repeats per condition and record all results rather than reporting only the best sample.
