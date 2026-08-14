import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../cindy-art/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', root), 'utf8'));
const source = readFileSync(new URL('main.js', root), 'utf8');

function mediaCatalogsForPreferences(configuredModels) {
  const catalogs = { image: [], video: [] };
  const requirements = {
    'image.generate': { type: 'image', input: ['text'], output: ['image'] },
    'image.edit': { type: 'image', input: ['text', 'image'], output: ['image'] },
    'video.generate': { type: 'video', input: ['text'], output: ['video'] },
    'video.edit': { type: 'video', input: ['text', 'image'], output: ['video'] },
  };
  for (const [capability, id] of Object.entries(configuredModels)) {
    const requirement = requirements[capability];
    if (!requirement) continue;
    let model = catalogs[requirement.type].find((candidate) => candidate.id === id);
    if (!model) {
      model = { id, name: id, modalities: { input: [], output: [] } };
      catalogs[requirement.type].push(model);
    }
    model.modalities.input = [...new Set([...model.modalities.input, ...requirement.input])];
    model.modalities.output = [...new Set([...model.modalities.output, ...requirement.output])];
  }
  return catalogs;
}

function createHarness(initialKv = {}, mediaCatalogs = { image: [], video: [] }) {
  let handler;
  let kv = structuredClone(initialKv);
  const catalogs = structuredClone(mediaCatalogs);
  const results = [];
  const broadcasts = [];
  const fetches = [];

  class FakeBroadcastChannel {
    postMessage(message) {
      broadcasts.push(message);
    }
  }

  const cindy = {
    onHostMessage(nextHandler) {
      handler = nextHandler;
    },
    ping() {
      return Promise.resolve();
    },
    async send(message) {
      if (message.type !== 'tool-result') {
        throw new Error(`unexpected cindy.send type: ${message.type}`);
      }
      results.push(message);
      return { ok: true };
    },
  };

  async function fetch(path, options = {}) {
    fetches.push({ path, options });
    if (path === '/media-models?type=image' || path === '/media-models?type=video') {
      const type = path.endsWith('image') ? 'image' : 'video';
      const models = catalogs[type];
      return {
        ok: true,
        json: async () => ({
          ok: true,
          type,
          models: structuredClone(models),
          defaultModelId: models[0]?.id ?? null,
        }),
      };
    }
    if (path !== '/kv') return { ok: false };
    if (!options.method || options.method === 'GET') {
      return { ok: true, json: async () => structuredClone(kv) };
    }
    if (options.method === 'PUT') {
      kv = JSON.parse(options.body);
      return { ok: true };
    }
    return { ok: false };
  }

  vm.runInNewContext(source, {
    Array,
    BroadcastChannel: FakeBroadcastChannel,
    Date,
    Error,
    JSON,
    Promise,
    String,
    TextEncoder,
    cindy,
    fetch,
  });
  assert.equal(typeof handler, 'function');

  return {
    broadcasts,
    fetches,
    get kv() {
      return kv;
    },
    async call(tool, args) {
      await handler({ type: 'tool-call', tool, callId: `call-${tool}`, args });
      await new Promise((resolve) => setImmediate(resolve));
      return results.at(-1);
    },
  };
}

test('manifest accepts dynamic media model ids and exposes a result import tool', () => {
  assert.equal(manifest.version, '1.12.6');
  assert.equal(manifest.minCindyVersion, '0.1.47');
  assert.equal(manifest.slots.includes('card'), false);
  for (const toolName of ['gen_image', 'edit_image', 'gen_video', 'edit_video']) {
    const tool = manifest.tools.find(({ name }) => name === toolName);
    assert.ok(tool, `${toolName} declaration is missing`);
    assert.equal(tool.parameters.properties.model.type, 'string');
    assert.equal(tool.parameters.properties.model.enum, undefined);
  }
  assert.ok(manifest.tools.some(({ name }) => name === 'import_artwork'));
});

test('creation tools return ordinary parameters and read Art panel preferences', async () => {
  const configured = {
    'image.generate': 'image-model',
    'image.edit': 'image-model',
    'video.generate': 'video-model',
    'video.edit': 'video-model',
  };
  const harness = createHarness(
    { imageModelId: 'image-model', videoModelId: 'video-model' },
    mediaCatalogsForPreferences(configured),
  );

  const image = await harness.call('gen_image', { prompt: 'a cat', tier: 'best' });
  const video = await harness.call('gen_video', { prompt: 'a running cat' });

  assert.equal(image.ok, true);
  assert.equal(image.result.request.capability, 'image.generate');
  assert.equal(image.result.request.modelId, 'image-model');
  assert.equal(image.result.request.qualityIntent, 'best');
  assert.equal(video.result.request.capability, 'video.generate');
  assert.equal(video.result.request.modelId, 'video-model');
  assert.equal(
    harness.fetches.some(({ path }) => path === '/media-models?type=image'),
    true,
  );
  assert.equal(
    harness.fetches.some(({ path }) => path === '/media-models?type=video'),
    true,
  );
});

test('edit tools reuse the two Art panel model preferences', async () => {
  const hash = 'b'.repeat(64);
  const configured = {
    'image.generate': 'qwen/qwen-image-3',
    'image.edit': 'qwen/qwen-image-3',
    'video.generate': 'minimax/minimax-h3',
    'video.edit': 'minimax/minimax-h3',
  };
  const harness = createHarness(
    { imageModelId: 'qwen/qwen-image-3', videoModelId: 'minimax/minimax-h3' },
    mediaCatalogsForPreferences(configured),
  );

  const image = await harness.call('edit_image', {
    prompt: 'add Chinese elements',
    images: [`cindy-ghost://cindy-art/media/${hash}.png`],
  });
  const video = await harness.call('edit_video', {
    prompt: 'make it move',
    images: [`cindy-media://blobs/${hash}.png`],
  });

  assert.equal(image.result.request.modelId, 'qwen/qwen-image-3');
  assert.deepEqual(structuredClone(image.result.request.referenceMedia.pluginMediaUrls), [
    `cindy-media://blobs/${hash}.png`,
  ]);
  assert.equal(video.result.request.modelId, 'minimax/minimax-h3');
});

test('Art interprets modalities and rejects a configured model that cannot perform the action', async () => {
  const hash = 'c'.repeat(64);
  const harness = createHarness(
    { imageModelId: 'text-only-image' },
    {
      image: [
        {
          id: 'text-only-image',
          name: 'Text Only Image',
          modalities: { input: ['text'], output: ['image'] },
        },
      ],
      video: [],
    },
  );

  const result = await harness.call('edit_image', {
    prompt: 'add snow',
    images: [`cindy-media://blobs/${hash}.png`],
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /未声明支持改图所需的输入输出模态/);
});

test('import_artwork requires a granted Core result and stores gallery state inside Art', async () => {
  const hash = 'a'.repeat(64);
  const mediaUrl = `cindy-media://blobs/${hash}.png`;
  const pluginMediaUrl = `cindy-ghost://cindy-art/media/${hash}.png`;
  const harness = createHarness();

  const denied = await harness.call('import_artwork', { mediaUrl, caption: 'cat' });
  assert.equal(denied.ok, false);

  const imported = await harness.call('import_artwork', {
    mediaUrl: pluginMediaUrl,
    caption: 'cat',
    attachments: [hash],
  });
  assert.equal(imported.ok, true);
  assert.deepEqual(
    harness.kv.artworks.map(({ src, caption }) => ({ src, caption })),
    [{ src: `cindy-ghost://cindy-art/media/${hash}.png`, caption: 'cat' }],
  );
  assert.deepEqual(structuredClone(harness.broadcasts), [
    { type: 'artwork', src: `cindy-ghost://cindy-art/media/${hash}.png`, caption: 'cat' },
  ]);
  assert.equal(harness.fetches.some(({ path }) => path === '/gallery'), false);
});
