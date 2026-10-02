# Standard image execution

Parent: #284. Design: #285. This is the replacement contract; the Scene execution
contract is retired. Application version changes belong to release preparation.

## Graph and task identity

Compiler 3 emits standard ComfyUI nodes only. A project preview contains one
SaveImage output per Leaf. Each output has `_meta.batchStudio` containing
`contract: 1`, `branchId`, `leafId`. This binding is included in the graph hash.
Execution follows Prompt Plan order, validates an exact bijection between outputs
and Leaves, and submits only the output and its ancestors. No Matrix, Expand,
run handle, custom HTTP endpoint, or custom-node discovery is involved.

Illustrious loads a checkpoint; Anima loads UNET, CLIP and VAE separately and uses
EmptySD3LatentImage. Each model path applies standard LoraLoader nodes in root,
then Branch order, with independent MODEL and CLIP strengths. Zero LoRAs means a
direct connection. Both text encoders use the resulting CLIP. Each Leaf has one
KSampler, one latent with batch_size=1, VAEDecode and SaveImage.

## Prompts and seeds

Batch Studio composes common, Branch and Leaf prompts before submission. The
existing Prompt Plan policy determines quality prefixes, trigger selection and
tag order. Structured tags are deduplicated in first-occurrence order; opaque
free text is concatenated without splitting commas or rewriting parentheses.
Positive and negative remain separate. No implicit Scene weight rescaling or
global underscore conversion is retained. Authored weights and trainedWords are
passed verbatim. Model-family prompt authoring policy remains in Batch Studio.

Project previews use seed 0. Run creation assigns each KSampler an independent
random integer below 2^48 - 1, safe in JavaScript and accepted by ComfyUI. Seeded UI
and API graphs are persisted into the immutable Run snapshot, with fresh hashes
and identity; source workflow identity is retained separately for stale checks.
Resume reuses these graphs and seeds. New Runs allocate new seeds. Input equality
does not authorize retrying a POST whose acceptance is uncertain.

## Submission, output and metadata

One Leaf means one POST and one image. The next POST waits for the previous
terminal History entry. Before POST, persist attempt ID and submitted graph hash;
Queue/History reconciliation determines whether an uncertain attempt was accepted.
Keep existing stop, interrupt, collection-failure and duplicate-prevention rules.

SaveImage filename_prefix is scoped to project/Run/Branch/Leaf. Returned History
filename/subfolder is authoritative; validate containment and hash the retrieved
image. Record prompt ID and Leaf mapping in evidence/manifest. Send a matching
per-image UI workflow plus Batch Studio task identity through extra_pnginfo. The
Run snapshot and evidence remain authoritative when PNG metadata is disabled.
Scene-specific filenames, metadata, callbacks and state sidecars are discontinued.

## Breaking transition

Old compiled graphs, templates, manifests and Run snapshots cannot execute or
resume. Reject them with a rebuild/new-Run message; never translate an existing
Run or rewrite its expected hashes. Keep saved data intact. Unresolved submissions
must be reconciled or explicitly resolved before replacement generation.

Remove mandatory custom-node repositories, settings, sync worker operations and
Scene execution client/code. Do not uninstall nodes from a user's ComfyUI. New
execution supports only the standard node allowlist. Historical decision logs may
describe the previous contract, but are not current implementation instructions.

## Validation gates

Test both model families, zero/multiple LoRAs, bindings and graph links, exact
prompt strings, immutable seed reuse, old-graph refusal, sequential POSTs,
uncertain acceptance, interruption/resume, collection failure and output hashes.
Run Local and Remote protocol regressions plus all repository tests/typecheck.
Real generation requires isolated standard ComfyUI environments and model assets;
record unavailable environments as unverified, never as a successful smoke test.
