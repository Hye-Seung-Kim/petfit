#!/usr/bin/env python3
"""Standalone Gemini pet virtual try-on feasibility spike.

Requires: pip install -U google-genai
Credential: export GEMINI_API_KEY=...
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

MODEL_DEFAULT = "gemini-3.1-flash-image"

OUTFITS = {
    "red hoodie": (
        "a plain red pet hoodie fitted around the torso, with the hood resting "
        "behind the neck and never over the head or ears; no text or logo"
    ),
    "yellow raincoat": (
        "a plain yellow waterproof pet raincoat fitted over the back and torso, "
        "with the collar below the jaw; no hood over the head, text, or logo"
    ),
    "formal black tuxedo": (
        "a formal black pet tuxedo jacket around the torso, with a white shirt "
        "front and a small black bow tie below the neck; no trousers, shoes, "
        "hat, text, or logo"
    ),
}

CORE_PRESERVATION = """Edit the provided dog image by adding only the selected pet outfit.

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
Produce one photorealistic virtual pet fashion preview."""

NEGATIVE_CONSTRAINTS = """Treat the dog input as the immutable source image and perform a localized torso-only edit.
Keep every visible pixel outside the garment and its physically necessary edge shadows as unchanged as possible.
Do not redraw, reinterpret, beautify, age, resize, rotate, or reposition the dog.
Do not change the crop, framing, lens perspective, depth of field, exposure, color grade, shadows, or background objects.
Do not change coat texture, fur length, muzzle shape, expression, gaze, ear shape, eye color, nose, paws, legs, or tail.
Do not add collars, leashes, accessories, people, animals, props, extra garment pieces, typography, watermarks, or branding.
The garment may occlude only the torso fur that it naturally covers. Preserve visible boundary markings exactly.
Return exactly one edited photorealistic image and no collage, comparison panel, or caption."""


def resolved_outfit(name_or_description: str) -> str:
    return OUTFITS.get(name_or_description.strip().lower(), name_or_description.strip())


def build_prompt(outfit: str, strategy: str, has_reference: bool) -> str:
    selected = resolved_outfit(outfit)
    reference = (
        "An outfit reference image follows the dog image. Use it only for the garment's design, "
        "material, construction, and color. Never copy its wearer, body, pose, background, text, "
        "or logos. The written outfit description wins if they conflict."
        if has_reference
        else "No outfit reference is supplied; follow the written outfit description."
    )
    if strategy == "simple":
        return (
            f"Edit the provided dog photo so the same dog is naturally wearing {selected}. "
            "Change only the clothing area, keep the dog and scene otherwise unchanged, and return one photorealistic image. "
            + reference
        )
    if strategy == "strict":
        return f"Selected outfit: {selected}\n\n{CORE_PRESERVATION}\n\n{reference}"
    return (
        f"Selected outfit: {selected}\n\n{CORE_PRESERVATION}\n\n"
        f"{NEGATIVE_CONSTRAINTS}\n\n{reference}\n\n"
        "Priority order: (1) exact dog identity and anatomy, (2) unchanged scene and composition, "
        "(3) plausible garment placement, (4) outfit styling. If the garment conflicts with identity preservation, simplify the garment rather than changing the dog."
    )


def image_mime(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    allowed = {"image/png", "image/jpeg", "image/webp"}
    if guessed not in allowed:
        raise ValueError(f"Unsupported image type for {path}; use PNG, JPEG, or WebP")
    return guessed


def output_path_for_mime(requested: Path, mime: str) -> Path:
    suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(mime, ".bin")
    return requested.with_suffix(suffix)


def response_image(response):
    parts = getattr(response, "parts", None) or []
    for part in parts:
        inline = getattr(part, "inline_data", None)
        if inline is not None and getattr(inline, "data", None):
            return bytes(inline.data), getattr(inline, "mime_type", None) or "image/png"
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                return bytes(inline.data), getattr(inline, "mime_type", None) or "image/png"
    raise RuntimeError("Gemini returned no image; inspect safety/policy feedback and retry with a simpler prompt")


def is_retryable(exc: Exception) -> bool:
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if callable(code):
        code = code()
    text = str(exc).lower()
    return code in {429, 500, 502, 503, 504} or any(
        marker in text for marker in ("429", "500", "502", "503", "504", "resource_exhausted", "unavailable", "deadline")
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add a described pet outfit to a user-provided dog image with Gemini.")
    parser.add_argument("--dog", type=Path, help="User-owned/licensed dog image (PNG/JPEG/WebP)")
    parser.add_argument("--outfit-reference", type=Path, help="Optional user-owned/licensed garment reference image")
    parser.add_argument("--outfit", required=True, help="Outfit preset name or free-form description")
    parser.add_argument("--strategy", choices=("simple", "strict", "negative"), default="negative")
    parser.add_argument("--model", default=os.getenv("GEMINI_IMAGE_MODEL", MODEL_DEFAULT))
    parser.add_argument("--output", type=Path, default=Path("outputs/result.png"))
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--print-prompt", action="store_true", help="Print the resolved prompt without calling Gemini")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prompt = build_prompt(args.outfit, args.strategy, args.outfit_reference is not None)
    if args.print_prompt:
        print(prompt)
        return 0
    if args.dog is None:
        print("error: --dog is required unless --print-prompt is used", file=sys.stderr)
        return 2
    for path in (args.dog, args.outfit_reference):
        if path is not None and not path.is_file():
            print(f"error: input does not exist: {path}", file=sys.stderr)
            return 2
    if not os.getenv("GEMINI_API_KEY"):
        print("error: GEMINI_API_KEY is not set; no API call was made", file=sys.stderr)
        return 2
    if args.attempts < 1:
        print("error: --attempts must be at least 1", file=sys.stderr)
        return 2

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("error: install the SDK with: python -m pip install -U google-genai", file=sys.stderr)
        return 2

    parts = [
        types.Part.from_text(text="SOURCE DOG IMAGE (identity and scene source of truth):"),
        types.Part.from_bytes(data=args.dog.read_bytes(), mime_type=image_mime(args.dog)),
    ]
    if args.outfit_reference:
        parts.extend([
            types.Part.from_text(text="OPTIONAL OUTFIT REFERENCE (garment cues only; never a subject or scene source):"),
            types.Part.from_bytes(data=args.outfit_reference.read_bytes(), mime_type=image_mime(args.outfit_reference)),
        ])
    parts.append(types.Part.from_text(text=prompt))

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    started = time.monotonic()
    response = None
    for attempt in range(1, args.attempts + 1):
        try:
            response = client.models.generate_content(
                model=args.model,
                contents=[types.Content(role="user", parts=parts)],
                config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
            )
            image_bytes, mime = response_image(response)
            break
        except Exception as exc:
            if attempt == args.attempts or not is_retryable(exc):
                print(f"error: Gemini request failed: {exc}", file=sys.stderr)
                return 1
            delay = min(2 ** (attempt - 1), 8) + random.random()
            print(f"transient Gemini error; retrying in {delay:.1f}s ({attempt}/{args.attempts})", file=sys.stderr)
            time.sleep(delay)
    elapsed = time.monotonic() - started

    actual_output = output_path_for_mime(args.output, mime)
    actual_output.parent.mkdir(parents=True, exist_ok=True)
    actual_output.write_bytes(image_bytes)
    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "strategy": args.strategy,
        "outfit": args.outfit,
        "dog_input": args.dog.name,
        "outfit_reference": args.outfit_reference.name if args.outfit_reference else None,
        "output": actual_output.name,
        "mime_type": mime,
        "latency_seconds": round(elapsed, 3),
        "prompt": prompt,
        "evaluation_status": "not_scored",
        "note": "Scores, if later added, are qualitative hackathon testing notes, not scientific measurements.",
    }
    metadata_path = actual_output.with_suffix(actual_output.suffix + ".json")
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"saved image: {actual_output}")
    print(f"saved metadata: {metadata_path}")
    print(f"latency_seconds: {elapsed:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
