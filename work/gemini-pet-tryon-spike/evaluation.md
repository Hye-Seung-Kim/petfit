# Qualitative evaluation

These scores are **qualitative hackathon testing notes, not scientific measurements**. Score each generated image from 1 (poor) to 5 (strong) while viewing it beside the source at the same scale.

## Rubric anchors

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Identity preservation | Looks like a different dog | Recognizable, with visible facial/body drift | Same dog to a careful side-by-side review |
| Fur marking preservation | Major markings missing/changed | Small or partly occluded drift | All visible and boundary markings retained |
| Anatomy correctness | Extra/missing/deformed anatomy | Minor implausible geometry | Pose and anatomy remain coherent and unchanged |
| Outfit realism | Floating, fused, or implausible | Mostly wearable with minor artifacts | Natural drape, occlusion, seams, and shadows |
| Background preservation | Scene replaced or heavily redrawn | Noticeable local/global drift | Background, crop, perspective, and lighting retained |
| Overall demo suitability | Not usable | Usable with caveats | Convincing for a clearly labeled creative preview |

## Results matrix

No API run was possible during this spike because `GEMINI_API_KEY`/`GOOGLE_API_KEY` were not set and no user-provided dog image was present. Leave scores blank until each output exists.

| Outfit | Strategy | Output | Identity | Fur | Anatomy | Outfit | Background | Overall | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| red hoodie | simple | `outputs/simple-red-hoodie.*` | — | — | — | — | — | — | Not run |
| red hoodie | strict | `outputs/strict-red-hoodie.*` | — | — | — | — | — | — | Not run |
| red hoodie | negative | `outputs/negative-red-hoodie.*` | — | — | — | — | — | — | Not run |
| yellow raincoat | simple | `outputs/simple-yellow-raincoat.*` | — | — | — | — | — | — | Not run |
| yellow raincoat | strict | `outputs/strict-yellow-raincoat.*` | — | — | — | — | — | — | Not run |
| yellow raincoat | negative | `outputs/negative-yellow-raincoat.*` | — | — | — | — | — | — | Not run |
| formal black tuxedo | simple | `outputs/simple-formal-black-tuxedo.*` | — | — | — | — | — | — | Not run |
| formal black tuxedo | strict | `outputs/strict-formal-black-tuxedo.*` | — | — | — | — | — | — | Not run |
| formal black tuxedo | negative | `outputs/negative-formal-black-tuxedo.*` | — | — | — | — | — | — | Not run |

## Review checklist

1. Compare eyes, muzzle, nose, ears, expression, gaze, and head silhouette.
2. Compare every visible fur patch, especially where garment edges meet fur.
3. Count and inspect all limbs and paws; check the tail and torso silhouette.
4. Inspect garment edges for fusion, floating fabric, bad straps, or impossible folds.
5. Blink between source and output to catch crop, lens, lighting, and background drift.
6. Reject any output containing a logo, caption, watermark-like text, or unrequested accessory.
7. Record failures; do not average away a catastrophic anatomy or identity error.

## Acceptance suggestion for a live demo

Use an output only if identity, anatomy, background, and overall suitability are each at least 4/5 and no hard-reject issue in step 6 appears. This threshold is a demo gate, not a validated metric.
