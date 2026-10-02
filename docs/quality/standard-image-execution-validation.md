# Standard Image Execution Validation

Parent issue: #284 / Validation issue: #290

Date: 2026-10-02. This report covers the dependency removal collected on
`codex/284-remove-custom-node-dependencies`.

## Implementation

Compiler 3 builds standard ComfyUI graphs. Root/Branch LoRAs use sequential
LoraLoader nodes; Batch Studio composes the final prompts. Every Leaf owns one
sampler, batch_size 1 and SaveImage binding. Local and Remote submit the bound
output's ancestors through standard POST /prompt. Seeds are pinned when creating
the immutable Run snapshot and reused during Resume.

Removed the Scene HTTP client, custom-node specifications, repository settings,
environment editor and Remote sync operation. Legacy templates/manifests/graphs
and Run snapshots cannot execute or Resume. No compatibility adapter remains.
Remote Worker protocol is 12, generation state is 2 and artifact manifest is 2.
Application version remains 0.79.0; release preparation is outside this change.

## Automated validation

- Entire `npm test`: PASS under Ubuntu 24.04 WSL, Node 24.16.0 and Python 3.12.
  Linux is necessary for the actual Remote Worker's fcntl locking tests.
- `npm run typecheck`: PASS.
- `npm run check`: PASS. Six unrelated existing unused-variable warnings remain.
- `npm run build`: PASS on an isolated copy of the same source and dependencies,
  including renderer, Electron compile, IPC check and runtime asset copy.
  The normal workspace build guard correctly refuses to overwrite the running
  Batch Studio application; its existing outputs were preserved.
- `git diff --check`: PASS.

Regressions cover both model families; zero/multiple LoRAs and independent MODEL/
CLIP strengths; shared Root and isolated Branch chains; deterministic prompt
strings and UI/API equivalence; exact SaveImage/Leaf bindings; batch_size > 1
refusal; seed allocation and immutable reuse; old Run refusal; sequential POSTs;
lost acknowledgments and Queue/History recovery; Stop/Interrupt/Resume; collection
failure; scoped filenames; output size/hash validation; Remote packaging and
artifact transfer; bootstrap without custom-node synchronization.

## Real ComfyUI smoke

A separate ComfyUI process ran on loopback port 8189 with
`--disable-all-custom-nodes`, and separate input/output/temp/user directories.
The server log confirmed that loading custom nodes was skipped. Hardware was
AMD Radeon RX 6600M; the existing PyTorch/ROCm environment was used.

Both families generated a benign red cube at 64 × 64, one step, no LoRAs. This
checks execution contracts rather than visual quality. Multiple-LoRA behavior
is covered by the automated graph tests, not this real generation smoke.

| Family | Assets | Standard graph POST | Compiler → seeded Run → Local execution → verified output |
| --- | --- | --- | --- |
| Illustrious | waiIllustriousSDXL_v170.safetensors | PASS, one image, seed 284 | COMPLETED, 1/1, Run ca445a01-16a6-49f7-b28e-6de7d70039ab |
| Anima | anijpaint_v1.safetensors + qwen_3_06b_base.safetensors + qwen_image_vae.safetensors | PASS, one image, seed 284 | COMPLETED, 1/1, Run bb3a36de-46c3-4761-821e-2a45b0d71313 |

The direct POST outputs contained PNG prompt and UI workflow metadata with the
same standard node types and seed. SHA-256 values:

- Illustrious: de0f6de221a6254d1c2bd454898a6a18a718fc3221ec90a6175208bd89faf8f3
- Anima: 32d523ea022d2e4bef92825dce5e441966956dffca6d875c4132bc9ad5326b3b

Local end-to-end runs recorded Branch/Leaf/prompt identity, per-file size/SHA-256,
generation completion and LOCAL_FILE_VERIFIED evidence. The real Linux Remote
Worker also completed both families and packaged one image each into a ZIP with
manifest v2, imageTasks identity and submitted inputs. Because WSL-to-Windows
network access was filtered, a test-only loopback HTTP relay carried requests
over process stdio; the Worker generation/History/packaging code was unchanged.
Its output directory was the same isolated ComfyUI output tree, mounted in WSL.
Run IDs were remote-smoke-illustrious and remote-smoke-anima.

Temporary fixtures and
projects supplied READY preflight fixtures; catalog synchronization and model
placement were not repeated in this real generation smoke. Their regressions
passed in the complete test suite. Smoke
logs reside in ignored node_modules/.cache/standard-smoke-284. No cloud instance
was provisioned or charged. Actual Vast.ai/SSH/R2 generation remains unverified.
Remote Worker control/recovery/package/transfer paths passed Linux regressions.

## Upgrade behavior

Existing users regenerate Workflow and create a new Run. Old saved data remains
intact. Unresolved submissions must be reconciled before replacement generation.
Installed custom_nodes on a user's ComfyUI are not uninstalled by this update.
