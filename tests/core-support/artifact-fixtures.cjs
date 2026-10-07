const catalog = { schemaVersion: 1, generation: 1, generatedAt: '2026-09-15T00:00:00Z' };
const model = (ref, fileName, trainedWords, id) => ({
  ref,
  modelId: id,
  modelName: ref,
  versionId: id + 1000,
  versionName: 'v1',
  fileId: id + 2000,
  fileName,
  modelUrl: 'https://example.com/model',
  trainedWords,
  reason: 'test',
});

function artifacts() {
  const checkpoint = model('checkpoint.main', 'base.safetensors', ['base_trigger'], 1);
  const character = model('lora.character', 'character.safetensors', ['character_trigger'], 2);
  const pose = model('lora.pose', 'pose.safetensors', ['pose_trigger'], 3);
  const models = {
    schemaVersion: 5,
    modelFamily: 'illustrious',
    catalog,
    checkpoint,
    loras: [character, pose],
  };
  const plan = {
    schemaVersion: 2,
    common: {
      positive: {
        subject: ['1girl'],
        identity: ['kitagawa_marin', 'sono_bisque_doll_wa_koi_wo_suru'],
        appearance: ['long_hair', 'pink_eyes'],
      },
      negative: {
        identity: ['another_character'],
      },
    },
    rootLoras: [{ modelRef: 'lora.character', strengthModel: 0.7, strengthClip: 0.7 }],
    branches: [
      {
        id: 'b01',
        label: 'Clothed intro',
        loras: [{ modelRef: 'lora.pose', strengthModel: 0.6, strengthClip: 0.6 }],
        prompt: {
          positive: {
            outfit: ['crop_top', 'miniskirt'],
            environment: ['indoors', 'living_room'],
          },
          negative: {},
        },
        leaves: [
          {
            id: 's1-01-c1',
            name: 'S1-01_C1_intro',
            prompt: {
              positive: {
                expression: ['smile'],
                pose: ['standing'],
                camera: {
                  angle: ['from_below'],
                  framing: ['cowboy_shot'],
                  gaze: ['looking_at_viewer'],
                },
              },
              negative: {},
            },
          },
        ],
      },
    ],
  };

  return { models, plan };
}
module.exports = { artifacts };
