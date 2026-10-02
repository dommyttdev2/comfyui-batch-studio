module.exports = function standardGraph(branches) {
  const graph = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
    2: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'positive' } },
    3: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'negative' } },
  };
  let id = 3;
  for (const branch of branches)
    for (const leafId of branch.leafIds) {
      const latent = String(++id),
        sampler = String(++id),
        decode = String(++id),
        save = String(++id);
      graph[latent] = {
        class_type: 'EmptyLatentImage',
        inputs: { width: 64, height: 64, batch_size: 1 },
      };
      graph[sampler] = {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: [latent, 0],
          seed: 0,
          steps: 1,
          cfg: 1,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1,
        },
      };
      graph[decode] = { class_type: 'VAEDecode', inputs: { samples: [sampler, 0], vae: ['1', 2] } };
      graph[save] = {
        class_type: 'SaveImage',
        inputs: { images: [decode, 0], filename_prefix: 'BatchStudio/test' },
        _meta: { title: 'Save', batchStudio: { contract: 1, branchId: branch.branchId, leafId } },
      };
    }
  return graph;
};
