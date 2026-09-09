"""
Renders the card art described by dist-cards/art-jobs.json.

This is the pixel half of `npm run art:generate`; `tools/gen-art.ts` is the
prompt half and writes the job file. Run it through npm rather than directly:

    npm run art:generate
    npm run art:generate -- --sample --steps=8

Why local rather than a hosted image API: the free endpoints throttle anonymous
callers to roughly one image per 45 seconds per address, which is about seven
hours for one full run of 559 and a fresh failure every time the limit moves. A
local model is unmetered, works offline, costs nothing, and takes a real
`negative_prompt` -- which is the only reliable way to keep lettering and
decorative borders out of the frame, since a positive-only prompt summons
whatever it names.

Determinism: every image comes from `torch.Generator().manual_seed(job.seed)`
and the seed is a hash of the card's art key, so re-running reproduces the set
exactly. That is the same property the engine has, for the same reason.

Defaults target a 4 GB laptop GPU (the machine this was built on): a distilled
LCM model at 512x512, 6 steps, attention slicing on, batch of one. Peak VRAM
sits near 2.5 GB.
"""

import argparse
import json
import os
import sys
import time

# Keep HF from printing a progress bar per file into our progress stream.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "0")

DEFAULT_MODEL = "SimianLuo/LCM_Dreamshaper_v7"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Render Jlore Jlards card art.")
    p.add_argument("--jobs", required=True, help="path to art-jobs.json")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--steps", type=int, default=6)
    p.add_argument("--guidance", type=float, default=1.8)
    p.add_argument("--quality", type=int, default=90, help="JPEG quality")
    p.add_argument("--device", default="cuda")
    return p.parse_args()


def load_pipeline(model: str, device: str):
    import torch
    from diffusers import AutoPipelineForText2Image, LCMScheduler

    if device == "cuda" and not torch.cuda.is_available():
        print("art_render: no CUDA device, falling back to CPU (this will be slow)")
        device = "cpu"

    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = AutoPipelineForText2Image.from_pretrained(
        model,
        torch_dtype=dtype,
        safety_checker=None,
        requires_safety_checker=False,
    )
    # LCM-distilled checkpoints need their own scheduler to hit quality in <10
    # steps; without it the same step count produces mush.
    if "lcm" in model.lower():
        pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    # 4 GB card: slicing trades a little speed for headroom that we need.
    pipe.enable_attention_slicing()
    return pipe, device


def main() -> int:
    args = parse_args()

    with open(args.jobs, "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    jobs = spec["jobs"]
    size = int(spec.get("size", 512))
    out_dir = spec["outDir"]
    os.makedirs(out_dir, exist_ok=True)

    if not jobs:
        print("art_render: nothing to do")
        return 0

    print(f"art_render: {len(jobs)} images, model={args.model}, steps={args.steps}", flush=True)

    import torch

    t0 = time.time()
    pipe, device = load_pipeline(args.model, args.device)
    print(f"art_render: pipeline ready in {time.time() - t0:.1f}s on {device}", flush=True)

    # CLIP silently drops everything past 77 tokens, and diffusers reports it in
    # a warning that scrolls past in a run this size. Since the style clauses sit
    # at the end of the prompt, an overrun costs exactly the terms that hold the
    # set together -- so check up front and say so once, loudly, before spending
    # ten minutes rendering the wrong thing.
    over = []
    limit = getattr(pipe.tokenizer, "model_max_length", 77)
    for job in jobs:
        n_tok = len(pipe.tokenizer(job["prompt"]).input_ids)
        if n_tok > limit:
            over.append((n_tok, job["key"]))
    if over:
        over.sort(reverse=True)
        print(
            f"art_render: WARNING {len(over)} prompt(s) exceed the {limit}-token "
            f"window and will be truncated:",
            flush=True,
        )
        for n_tok, key in over[:10]:
            print(f"  ! {n_tok} tokens  {key}")

    started = time.time()
    done = 0
    failed: list[str] = []

    for i, job in enumerate(jobs):
        key = job["key"]
        dest = os.path.join(out_dir, f"{key}.jpg")
        try:
            gen = torch.Generator(device=device).manual_seed(int(job["seed"]) % (2**31 - 1))
            image = pipe(
                prompt=job["prompt"],
                negative_prompt=job.get("negative") or None,
                num_inference_steps=args.steps,
                guidance_scale=args.guidance,
                width=size,
                height=size,
                generator=gen,
            ).images[0]
            # Write to a temp name first so an interrupted run never leaves a
            # half-written file that the resume check would accept.
            tmp = dest + ".part"
            image.convert("RGB").save(tmp, "JPEG", quality=args.quality, optimize=True)
            os.replace(tmp, dest)
            done += 1
        except Exception as exc:  # noqa: BLE001 - one bad card must not end the run
            failed.append(f"{key}: {type(exc).__name__}: {exc}")

        n = i + 1
        if n % 10 == 0 or n == len(jobs):
            elapsed = time.time() - started
            rate = n / max(elapsed, 1e-3)
            eta = int((len(jobs) - n) / rate) if rate > 0 else 0
            print(
                f"  {n}/{len(jobs)}  ok {done}  fail {len(failed)}  "
                f"{rate:.2f}/s  eta {eta // 60}m{eta % 60:02d}s",
                flush=True,
            )

    elapsed = time.time() - started
    print(f"art_render: {done} written, {len(failed)} failed, {elapsed / 60:.1f}m", flush=True)
    if device == "cuda":
        print(f"art_render: peak VRAM {torch.cuda.max_memory_allocated() / 1e9:.2f} GB")
    for line in failed[:20]:
        print(f"  ! {line}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
