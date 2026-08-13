/**
 * Art 画廊面板：回放并展示已收录作品。
 * 面板不发起生成请求；生成由聊天中的当前 Agent 调 Cindy Core media。
 */

var wall = document.getElementById('wall');
var flow = document.getElementById('flow');
var empty = document.getElementById('empty');
var imageModel = document.getElementById('image-model');
var videoModel = document.getElementById('video-model');
var modelStatus = document.getElementById('model-status');
var hung = {};

function hang(src, caption, append) {
  if (typeof src !== 'string' || src.indexOf('cindy-ghost://cindy-art/media/') !== 0) return;
  if (hung[src]) return;
  hung[src] = true;

  if (empty) {
    empty.remove();
    empty = null;
  }

  var capText = typeof caption === 'string' ? caption : '';
  var isVideo = /\.(mp4|webm)$/.test(src);
  var fig = document.createElement('figure');
  fig.className = 'artwork';

  if (isVideo) {
    var video = document.createElement('video');
    video.src = src;
    video.preload = 'metadata';
    video.muted = true;

    var vlink = document.createElement('a');
    vlink.className = 'artwork-link';
    vlink.style.position = 'relative';
    vlink.href = src.replace('/media/', '/preview/');
    vlink.appendChild(video);

    var badge = document.createElement('span');
    badge.className = 'artwork-video-badge';
    vlink.appendChild(badge);
    vlink.addEventListener('dragstart', function (event) {
      event.dataTransfer.setData('text/uri-list', src);
      event.dataTransfer.setData('text/plain', src);
      var rect = vlink.getBoundingClientRect();
      var offsetX = event.clientX - rect.left;
      var offsetY = event.clientY - rect.top;
      if (video.readyState >= 2 && video.videoWidth > 0 && rect.width > 0) {
        var dpr = window.devicePixelRatio || 1;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        canvas.style.position = 'fixed';
        canvas.style.left = '-10000px';
        canvas.style.top = '0';
        try {
          var ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(0, 0, rect.width, rect.height, 10);
            ctx.clip();
          }
          ctx.drawImage(video, 0, 0, rect.width, rect.height);
          document.body.appendChild(canvas);
          event.dataTransfer.setDragImage(canvas, offsetX, offsetY);
          setTimeout(function () { canvas.remove(); }, 0);
          return;
        } catch (error) {
          canvas.remove();
        }
      }
      event.dataTransfer.setDragImage(vlink, offsetX, offsetY);
    });
    fig.appendChild(vlink);
  } else {
    var img = document.createElement('img');
    img.src = src;
    img.alt = capText;
    img.draggable = false;

    var link = document.createElement('a');
    link.className = 'artwork-link';
    link.href = src.replace('/media/', '/preview/');
    link.appendChild(img);
    link.addEventListener('dragstart', function (event) {
      event.dataTransfer.setData('text/uri-list', src);
      event.dataTransfer.setData('text/plain', src);
      var rect = img.getBoundingClientRect();
      event.dataTransfer.setDragImage(img, event.clientX - rect.left, event.clientY - rect.top);
    });
    fig.appendChild(link);
  }

  var cap = document.createElement('figcaption');
  cap.textContent = capText;
  if (capText) {
    cap.title = capText;
    cap.addEventListener('click', function () {
      if (cap.classList.contains('is-expanded')) cap.classList.remove('is-expanded');
      else if (cap.classList.contains('is-clamped')) cap.classList.add('is-expanded');
    });
    requestAnimationFrame(function () {
      if (cap.scrollHeight > cap.clientHeight + 1) cap.classList.add('is-clamped');
    });
  }
  fig.appendChild(cap);
  if (append) flow.appendChild(fig);
  else flow.insertBefore(fig, flow.firstChild);
}

var scrollIdleTimer = null;
wall.addEventListener(
  'scroll',
  function () {
    wall.classList.add('is-scrolling');
    if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(function () {
      scrollIdleTimer = null;
      wall.classList.remove('is-scrolling');
    }, 2000);
  },
  { passive: true },
);

function readJson(path, fallback) {
  return fetch(path)
    .then(function (response) {
      if (!response.ok) throw new Error('request failed');
      return response.json();
    })
    .catch(function () { return fallback; });
}

function showModelStatus(message, isError) {
  modelStatus.textContent = message || '';
  if (isError) modelStatus.classList.add('is-error');
  else modelStatus.classList.remove('is-error');
}

function fillModelSelect(select, catalog, configuredId) {
  select.textContent = '';
  var models = catalog && catalog.ok === true && Array.isArray(catalog.models)
    ? catalog.models
    : [];
  if (models.length === 0) {
    var emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '暂无可用模型';
    select.appendChild(emptyOption);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (var index = 0; index < models.length; index += 1) {
    var model = models[index];
    if (!model || typeof model.id !== 'string') continue;
    var option = document.createElement('option');
    option.value = model.id;
    option.textContent = typeof model.name === 'string' && model.name ? model.name : model.id;
    select.appendChild(option);
  }
  var available = models.some(function (model) {
    return model && model.id === configuredId;
  });
  select.value = available
    ? configuredId
    : catalog.defaultModelId || (models[0] && models[0].id) || '';
}

var preferenceWrite = Promise.resolve();
function saveModelPreference(key, select) {
  preferenceWrite = preferenceWrite.then(async function () {
    showModelStatus('正在保存…', false);
    var state = await readJson('/kv', {});
    state[key] = select.value;
    var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(state) });
    if (!response.ok) throw new Error('模型配置保存失败');
    showModelStatus('已保存', false);
  }).catch(function (error) {
    showModelStatus(String((error && error.message) || error), true);
  });
}

Promise.all([
  readJson('/kv', {}),
  readJson('/media-models?type=image', { ok: false, models: [] }),
  readJson('/media-models?type=video', { ok: false, models: [] }),
]).then(function (values) {
  var state = values[0];
  fillModelSelect(imageModel, values[1], state && state.imageModelId);
  fillModelSelect(videoModel, values[2], state && state.videoModelId);
  if (imageModel.disabled && videoModel.disabled) {
    showModelStatus('当前没有可用的媒体模型', true);
  }
});

imageModel.addEventListener('change', function () {
  saveModelPreference('imageModelId', imageModel);
});
videoModel.addEventListener('change', function () {
  saveModelPreference('videoModelId', videoModel);
});

readJson('/kv', {}).then(function (state) {
  var artworks = state && Array.isArray(state.artworks) ? state.artworks : [];
  for (var index = 0; index < artworks.length; index += 1) {
    hang(artworks[index] && artworks[index].src, artworks[index] && artworks[index].caption, true);
  }
});

var channel = new BroadcastChannel('cindy-art');
channel.onmessage = function (event) {
  var message = event.data;
  if (message && message.type === 'artwork') hang(message.src, message.caption, false);
};

// 兼容旧版 Art 已写入 Host 画廊账本的存量作品；新作品只写插件自己的 KV。
readJson('/gallery', []).then(function (items) {
  if (!Array.isArray(items)) return;
  for (var index = 0; index < items.length; index += 1) {
    hang(items[index] && items[index].src, items[index] && items[index].caption, true);
  }
});
