/**
 * Art 电子脑：定义图片/视频创作的上层语义，不直接发媒体请求。
 *
 * 普通工具调用链：
 * 1. gen_image / edit_image / gen_video / edit_video 返回普通业务 JSON；
 * 2. 当前 Agent 读取结果后调用 Cindy Core media；
 * 3. Core 成功后，Agent 调 import_artwork 把受管媒体挂进本插件画廊。
 *
 * import_artwork 只收录 Host 按 attachmentArgs 授权给 Art 的媒体，不生成、
 * 不轮询、不下载，也不接触 endpoint 或凭证。
 */

/* global cindy */

const gallery = new BroadcastChannel('cindy-art');
const MANAGED_MEDIA_URL_RE = /^cindy-media:\/\/blobs\/([0-9a-f]{64})(\.[a-z0-9]{1,10})$/;
const PLUGIN_MEDIA_URL_RE =
  /^cindy-ghost:\/\/cindy-art\/media\/([0-9a-f]{64})(\.[a-z0-9]{1,10})$/;
const ART_KV_TARGET_BYTES = 60 * 1024;
const MEDIA_REQUIREMENTS = {
  'image.generate': { type: 'image', input: ['text'], output: 'image', label: '出图' },
  'image.edit': { type: 'image', input: ['text', 'image'], output: 'image', label: '改图' },
  'video.generate': { type: 'video', input: ['text'], output: 'video', label: '生成视频' },
  'video.image_to_video': {
    type: 'video',
    input: ['text', 'image'],
    output: 'video',
    label: '图生视频',
  },
};

function extractHash(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/[0-9a-f]{64}/);
  return match ? match[0] : null;
}

function failCall(callId, message) {
  return cindy
    .send({ type: 'tool-result', callId: callId, ok: false, message: message })
    .catch(function () {});
}

async function finishCall(callId, result) {
  await cindy.send({ type: 'tool-result', callId: callId, ok: true, result: result });
}

async function readPreferences() {
  try {
    const response = await fetch('/kv');
    if (!response.ok) return {};
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function validArtwork(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.src === 'string' &&
    value.src.startsWith('cindy-ghost://cindy-art/media/') &&
    typeof value.caption === 'string'
  );
}

async function saveArtwork(src, caption) {
  const state = await readPreferences();
  const previous = Array.isArray(state.artworks) ? state.artworks.filter(validArtwork) : [];
  state.artworks = [
    { src: src, caption: caption, createdAt: Date.now() },
    ...previous.filter(function (item) { return item.src !== src; }),
  ];
  while (
    state.artworks.length > 1 &&
    new TextEncoder().encode(JSON.stringify(state)).byteLength > ART_KV_TARGET_BYTES
  ) {
    state.artworks.pop();
  }
  const response = await fetch('/kv', {
    method: 'PUT',
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error('作品清单保存失败');
}

function optionalString(args, key) {
  return args && typeof args[key] === 'string' && args[key].trim()
    ? args[key].trim()
    : undefined;
}

async function readMediaCatalog(type) {
  const response = await fetch('/media-models?type=' + type);
  if (!response.ok) throw new Error('无法读取 Cindy 媒体模型目录');
  const result = await response.json();
  if (!result || result.ok !== true || result.type !== type || !Array.isArray(result.models)) {
    throw new Error('Cindy 媒体模型目录返回不合法');
  }
  return {
    models: result.models,
    defaultModelId:
      typeof result.defaultModelId === 'string' && result.defaultModelId.trim()
        ? result.defaultModelId.trim()
        : null,
  };
}

function supportsCapability(model, capability) {
  const requirement = MEDIA_REQUIREMENTS[capability];
  const modalities = model && model.modalities;
  if (
    !requirement ||
    !modalities ||
    !Array.isArray(modalities.input) ||
    !Array.isArray(modalities.output)
  ) {
    return false;
  }
  return (
    requirement.input.every(function (modality) {
      return modalities.input.indexOf(modality) !== -1;
    }) && modalities.output.indexOf(requirement.output) !== -1
  );
}

async function selectedModel(args, invocationCapability) {
  const requirement = MEDIA_REQUIREMENTS[invocationCapability];
  if (!requirement) throw new Error('Art 不认识媒体能力：' + invocationCapability);

  const catalog = await readMediaCatalog(requirement.type);
  const explicit = optionalString(args, 'model');
  let modelId;
  if (explicit) {
    modelId = explicit;
  } else {
    const preferences = await readPreferences();
    const preferenceKey = requirement.type + 'ModelId';
    const configured = optionalString(preferences, preferenceKey);
    modelId = catalog.models.some(function (candidate) {
      return candidate && candidate.id === configured;
    })
      ? configured
      : catalog.defaultModelId || (catalog.models[0] && catalog.models[0].id);
  }

  if (!modelId) {
    throw new Error(
      '当前没有可用的' + (requirement.type === 'image' ? '图片' : '视频') + '模型',
    );
  }
  const model = catalog.models.find(function (candidate) {
    return candidate && candidate.id === modelId;
  });
  if (!model) throw new Error('模型「' + modelId + '」当前不可用');
  if (!supportsCapability(model, invocationCapability)) {
    throw new Error('模型「' + modelId + '」未声明支持' + requirement.label + '所需的输入输出模态');
  }
  return modelId;
}

function sourceMedia(args, maxItems) {
  const urls = args && Array.isArray(args.images) ? args.images : [];
  const granted = args && Array.isArray(args.attachments) ? args.attachments : [];
  if (urls.length + granted.length === 0) return null;
  if (urls.length + granted.length > maxItems) {
    throw new Error('参考图数量超过上限(' + maxItems + ' 张)');
  }
  const normalized = [];
  for (let index = 0; index < urls.length; index += 1) {
    const managedMatch =
      typeof urls[index] === 'string' ? MANAGED_MEDIA_URL_RE.exec(urls[index]) : null;
    const pluginMatch =
      typeof urls[index] === 'string' ? PLUGIN_MEDIA_URL_RE.exec(urls[index]) : null;
    if (!managedMatch && !pluginMatch) {
      throw new Error('源图地址不合法:' + String(urls[index]));
    }
    normalized.push(
      pluginMatch
        ? 'cindy-media://blobs/' + pluginMatch[1] + pluginMatch[2]
        : urls[index],
    );
  }
  return {
    pluginMediaUrls: normalized,
    attachedMediaCount: granted.map(extractHash).filter(Boolean).length,
  };
}

async function returnArtRequest(msg, capability, options) {
  const args = msg.args || {};
  const prompt = optionalString(args, 'prompt');
  if (!prompt) return failCall(msg.callId, '缺少 prompt');

  let references;
  try {
    references = options && options.maxInputImages
      ? sourceMedia(args, options.maxInputImages)
      : undefined;
  } catch (error) {
    return failCall(msg.callId, String((error && error.message) || error));
  }
  if (options && options.requireImages && !references) {
    return failCall(msg.callId, '缺少参考图(images 或用户图片附件)');
  }

  let modelId;
  try {
    modelId = await selectedModel(args, capability);
  } catch (error) {
    return failCall(msg.callId, String((error && error.message) || error));
  }
  const aspectRatio = optionalString(args, 'aspectRatio');
  const qualityIntent = optionalString(args, 'tier');
  const request = {
    capability: capability,
    prompt: prompt,
  };
  if (modelId) request.modelId = modelId;
  if (aspectRatio) request.aspectRatioIntent = aspectRatio;
  if (qualityIntent) request.qualityIntent = qualityIntent;
  if (references) request.referenceMedia = references;

  await finishCall(msg.callId, {
    note:
      'Art 已整理创作参数。request.modelId 是已按 Art 面板「图片模型 / 视频模型」配置解析的最终模型；调用 Cindy Core media（完整工具名 mcp__cindy__media）prepare 时必须原样作为 model_id，不要 list_models 或另行选型，也不要查本地 API。referenceMedia.pluginMediaUrls 已归一化为 Core 可读取的受管地址，可直接使用；attachedMediaCount 对应用户随当前消息交出的媒体，调用 Core 时继续使用对话中的原始媒体地址。Core 成功后，对每个结果调用 cindy-art.import_artwork，只传 mediaUrl 和可选 caption，Host 会机械完成媒体授权。',
    request: request,
  });
}

function handleGenImage(msg) {
  return returnArtRequest(msg, 'image.generate');
}

function handleEditImage(msg) {
  return returnArtRequest(msg, 'image.edit', {
    requireImages: true,
    maxInputImages: 4,
  });
}

function handleGenVideo(msg) {
  return returnArtRequest(msg, 'video.generate');
}

function handleEditVideo(msg) {
  return returnArtRequest(msg, 'video.image_to_video', {
    requireImages: true,
    maxInputImages: 2,
  });
}

async function handleImportArtwork(msg) {
  const args = msg.args || {};
  const mediaUrl = optionalString(args, 'mediaUrl');
  const caption = optionalString(args, 'caption') || '';
  const match = mediaUrl ? MANAGED_MEDIA_URL_RE.exec(mediaUrl) : null;
  if (!match) {
    return failCall(msg.callId, 'mediaUrl 必须是 Cindy Core media 返回的受管媒体地址');
  }
  const hash = match[1];
  const ext = match[2].toLowerCase();
  const granted = Array.isArray(args.attachments)
    ? args.attachments.map(extractHash).filter(Boolean)
    : [];
  if (granted.indexOf(hash) === -1) {
    return failCall(
      msg.callId,
      'mediaUrl 未获得 Host 媒体授权，请使用原地址重试 import_artwork',
    );
  }

  const src = 'cindy-ghost://cindy-art/media/' + hash + ext;
  try {
    await saveArtwork(src, caption);
  } catch (error) {
    return failCall(msg.callId, String((error && error.message) || error));
  }
  gallery.postMessage({ type: 'artwork', src: src, caption: caption });
  await finishCall(msg.callId, { note: '作品已收录到 Art 画廊。' });
}

const HANDLERS = {
  gen_image: handleGenImage,
  edit_image: handleEditImage,
  gen_video: handleGenVideo,
  edit_video: handleEditVideo,
  import_artwork: handleImportArtwork,
};

cindy.onHostMessage(function (msg) {
  if (!msg || msg.type !== 'tool-call') return;
  const handler = HANDLERS[msg.tool] || null;
  if (!handler) {
    failCall(msg.callId, '未知工具:' + msg.tool);
    return;
  }
  handler(msg).catch(function (error) {
    failCall(msg.callId, String((error && error.message) || error));
  });
});

cindy.ping().catch(function () {});
