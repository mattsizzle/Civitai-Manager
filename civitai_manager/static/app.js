let _page = 1;
let _cursors = [null]; // _cursors[i] is the cursor used to fetch page i+1
let _curModel = null, _curVersion = null;
let _selFileIdx = null;
let _localFiles = [], _localDirs = [], _localSubdir = '';
let _activeTab = 'search';
let _carouselImgs = [], _carouselIdx = 0;
let _pendingDownload = null;
let _downloadAllMode = false;

// ── Tab switching ──────────────────────────────────────────────────────────────

function switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', (tab === 'search' && i === 0) || (tab === 'local' && i === 1));
  });
  document.getElementById('tab-search').classList.toggle('active', tab === 'search');
  document.getElementById('tab-local').classList.toggle('active', tab === 'local');
  if (tab === 'local') {
    document.getElementById('middle-panel').style.display = 'none';
    document.getElementById('right-panel').style.padding = '16px';
    document.getElementById('right-panel').innerHTML = '<div class="placeholder">Select a file to view details</div>';
    loadLocalFiles();
  } else {
    document.getElementById('middle-panel').style.display = 'flex';
    document.getElementById('right-panel').style.padding = '16px';
    document.getElementById('right-panel').innerHTML = '<div class="placeholder">Select a model to view details</div>';
  }
}

function togglePanel() {
  document.querySelector('.left-panel').classList.toggle('collapsed');
}

// ── URL / ID loader ────────────────────────────────────────────────────────────

function loadFromUrl() {
  const raw = document.getElementById('url-input').value.trim();
  if (!raw) return;
  if (/^\d+$/.test(raw)) {
    if (_activeTab !== 'search') switchTab('search');
    selectModel(parseInt(raw));
    document.getElementById('middle-panel').style.display = 'none';
    document.getElementById('url-input').value = '';
    return;
  }
  try {
    const u = new URL(raw);
    const m = u.pathname.match(/\/models\/(\d+)/);
    if (!m) { setStatus('Could not find a model ID in that URL'); return; }
    const modelId = parseInt(m[1]);
    const versionId = u.searchParams.get('modelVersionId')
      ? parseInt(u.searchParams.get('modelVersionId')) : null;
    if (_activeTab !== 'search') switchTab('search');
    selectModel(modelId, versionId);
    document.getElementById('middle-panel').style.display = 'none';
    document.getElementById('url-input').value = '';
  } catch {
    setStatus('Invalid URL');
  }
}

// ── Search ─────────────────────────────────────────────────────────────────────

async function doSearch(resetPage = true) {
  if (resetPage) { _page = 1; _cursors = [null]; }
  document.getElementById('search-btn').disabled = true;
  setStatus('Searching…');
  const params = new URLSearchParams({
    query: document.getElementById('q').value.trim(),
    types: document.getElementById('f-type').value,
    sort: document.getElementById('f-sort').value,
    period: document.getElementById('f-period').value,
    nsfw: document.getElementById('f-nsfw').value,
    tag: document.getElementById('f-tag').value.trim(),
    username: document.getElementById('f-creator').value.trim(),
    limit: document.getElementById('f-limit').value,
  });
  const cursor = _cursors[_page - 1];
  if (cursor) params.set('cursor', cursor);
  try {
    const data = await api('/api/models?' + params);
    const items = data.items || [];
    const meta = data.metadata || {};
    const nextCursor = meta.nextCursor || null;
    if (nextCursor) _cursors[_page] = nextCursor;
    document.getElementById('page-info').textContent = `Page ${_page}`;
    document.getElementById('prev-btn').disabled = _page <= 1;
    document.getElementById('next-btn').disabled = !nextCursor;
    const list = document.getElementById('results-list');
    const mid = document.getElementById('middle-panel');
    if (!items.length) {
      mid.style.display = 'none';
      list.innerHTML = '<div class="empty">No results</div>';
    } else {
      mid.style.display = 'flex';
      list.scrollTop = 0;
      list.innerHTML = items.map(m => {
        const nsfw = m.nsfw ? ' <span class="nsfw-tag">[NSFW]</span>' : '';
        const dl = (m.stats?.downloadCount || 0).toLocaleString();
        const up = (m.stats?.thumbsUpCount || 0).toLocaleString();
        return `<div class="result-item" id="ri-${m.id}" onclick="selectModel(${m.id})">
          <div class="rname">${x(m.name)}${nsfw}</div>
          <div class="rmeta">${x(m.type || '')} · ↓${dl} · 👍${up}</div>
        </div>`;
      }).join('');
    }
    const total = meta.totalItems ? meta.totalItems.toLocaleString() : items.length;
    document.getElementById('results-header').textContent = `Results (${total})`;
    setStatus(`Found ${total} results`);
  } catch (e) {
    document.getElementById('results-list').innerHTML = `<div class="empty">Error: ${x(e.message)}</div>`;
    setStatus('Search failed: ' + e.message);
  }
  document.getElementById('search-btn').disabled = false;
}

function goPage(d) {
  _page = Math.max(1, _page + d);
  doSearch(false);
}

// ── Model detail ───────────────────────────────────────────────────────────────

async function selectModel(id, versionId = null) {
  document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById('ri-' + id);
  if (el) el.classList.add('selected');
  document.getElementById('right-panel').innerHTML = '<div class="loading">Loading…</div>';
  setStatus('Loading…');
  try {
    const model = await api('/api/models/' + id);
    renderDetail(model);
    if (versionId) {
      const idx = (model.modelVersions || []).findIndex(v => v.id === versionId);
      if (idx > 0) {
        const sel = document.getElementById('ver-sel');
        if (sel) { sel.value = idx; onVersionChange(idx); }
      }
    }
    setStatus(model.name);
  } catch (e) {
    document.getElementById('right-panel').innerHTML = `<div class="placeholder">Error: ${x(e.message)}</div>`;
    setStatus('Error: ' + e.message);
  }
}

function renderDetail(model) {
  _curModel = model;
  const versions = model.modelVersions || [];
  _curVersion = versions[0] || null;
  _selFileIdx = null;

  const stats = model.stats || {};
  const tags = (model.tags || []).map(t => `<span class="tag">${x(t)}</span>`).join('');
  const creator = model.creator?.username || 'Unknown';
  const versOpts = versions.map((v, i) => {
    const ea = v.availability === 'EarlyAccess' ? ' [Early Access]' : '';
    return `<option value="${i}">${x(v.name || 'v' + v.id)}${ea}</option>`;
  }).join('');

  document.getElementById('right-panel').innerHTML = `
    <div class="model-name">${x(model.name)}</div>
    <div class="model-meta">${x(model.type || '')} · by ${x(creator)} · <a href="https://civitai.com/models/${model.id}" target="_blank" style="color:#5a9fd4">Open on Civitai ↗</a></div>
    <div class="model-stats">
      ↓ ${(stats.downloadCount||0).toLocaleString()} downloads ·
      👍 ${(stats.thumbsUpCount||0).toLocaleString()} ·
      👎 ${(stats.thumbsDownCount||0).toLocaleString()}
    </div>
    ${tags ? `<div class="model-tags">${tags}</div>` : ''}
    <div id="img-wrap"></div>
    <div class="section">
      <div class="section-title">Version</div>
      <select id="ver-sel" onchange="onVersionChange(+this.value)">${versOpts}</select>
      <div class="version-info" id="ver-info"></div>
      <table class="ftable">
        <thead><tr><th>File</th><th>Size</th><th>Format</th><th>Scan</th></tr></thead>
        <tbody id="ftbody"></tbody>
      </table>
      <div class="btn-row">
        <button class="btn" id="dl-btn" onclick="downloadSelected()">⬇ Download</button>
        ${versions.length > 1 ? `<button class="btn sec" onclick="downloadAllVersions()">⬇ All Versions (${versions.length})</button>` : ''}
        <button class="btn sec" onclick="saveInfoOnly()">Update Info JSON</button>
      </div>
      <div id="ea-notice" style="display:none;font-size:11px;color:#f88;margin-top:6px">
        ⚠ Early Access — must purchase or wait for public release on Civitai
      </div>
      <div class="dl-wrap" id="dl-wrap">
        <div class="dl-track"><div class="dl-bar" id="dl-bar"></div></div>
        <div class="dl-label" id="dl-label">Starting…</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Description</div>
      <div class="description" id="desc"></div>
    </div>`;

  if (versions.length) onVersionChange(0);
  document.getElementById('desc').innerHTML =
    model.description || '<span style="color:#555">No description</span>';
}

function _carouselImgError(el) {
  const ph = document.createElement('div');
  ph.className = 'img-ph';
  ph.style.margin = '0';
  ph.textContent = 'Image unavailable';
  el.replaceWith(ph);
}

function renderCarousel(images) {
  _carouselImgs = (images || []).filter(i => i.url);
  _carouselIdx = 0;
  const wrap = document.getElementById('img-wrap');
  if (!wrap) return;
  if (!_carouselImgs.length) { wrap.innerHTML = '<div class="img-ph">No preview images</div>'; return; }
  _drawCarousel();
}

function _drawCarousel() {
  const wrap = document.getElementById('img-wrap');
  if (!wrap) return;
  const img = _carouselImgs[_carouselIdx];
  const url = img.url.replace(/\/original=true\//, '/width=600/').replace(/width=\d+/, 'width=600');
  const multi = _carouselImgs.length > 1;
  wrap.innerHTML = `
    <div class="carousel">
      <img src="${url}" alt="" onerror="_carouselImgError(this)">
      ${multi ? '<button class="carousel-btn prev" onclick="carouselStep(-1)">&#8249;</button>' : ''}
      ${multi ? '<button class="carousel-btn next" onclick="carouselStep(1)">&#8250;</button>' : ''}
      ${multi ? `<div class="carousel-counter">${_carouselIdx + 1} / ${_carouselImgs.length}</div>` : ''}
    </div>`;
}

function carouselStep(d) {
  _carouselIdx = (_carouselIdx + d + _carouselImgs.length) % _carouselImgs.length;
  _drawCarousel();
}

function onVersionChange(idx) {
  const versions = _curModel?.modelVersions || [];
  _curVersion = versions[idx] || null;
  _selFileIdx = null;
  if (!_curVersion) return;
  const v = _curVersion;
  const parts = [];
  if (v.baseModel) parts.push('Base: ' + v.baseModel);
  if (v.trainedWords?.length) parts.push('Triggers: ' + v.trainedWords.join(', '));
  if (v.createdAt) parts.push('Created: ' + v.createdAt.slice(0, 10));
  document.getElementById('ver-info').textContent = parts.join(' · ');
  const isEA = v.availability === 'EarlyAccess';
  const dlBtn = document.getElementById('dl-btn');
  const eaNotice = document.getElementById('ea-notice');
  if (dlBtn) dlBtn.disabled = isEA;
  if (eaNotice) eaNotice.style.display = isEA ? 'block' : 'none';
  renderCarousel(v.images);
  const tbody = document.getElementById('ftbody');
  tbody.innerHTML = (v.files || []).map((f, i) => {
    const meta = f.metadata || {};
    const kb = f.sizeKB || 0;
    const size = kb > 1024 ? (kb/1024).toFixed(1)+' MB' : kb.toFixed(0)+' KB';
    const fmt = meta.format ? (meta.fp ? meta.format+'/'+meta.fp : meta.format) : '';
    const scan = f.virusScanResult || '';
    const cls = scan === 'Success' ? 'ok' : (scan === 'Danger' || scan === 'Error') ? 'bad' : '';
    return `<tr id="fr-${i}" onclick="selectFile(${i})">
      <td style="${f.primary ? 'font-weight:600' : ''}">${x(f.name||'')}</td>
      <td>${size}</td><td>${x(fmt)}</td><td class="${cls}">${x(scan)}</td>
    </tr>`;
  }).join('');
}

function selectFile(idx) {
  document.querySelectorAll('#ftbody tr').forEach(r => r.classList.remove('sel'));
  document.getElementById('fr-' + idx)?.classList.add('sel');
  _selFileIdx = idx;
}

function getFile() {
  const files = _curVersion?.files || [];
  if (_selFileIdx !== null && files[_selFileIdx]) return files[_selFileIdx];
  return files.find(f => f.primary) || files[0] || null;
}

// ── Download / save ────────────────────────────────────────────────────────────

async function _openSaveModal(allVersions = false) {
  try {
    const data = await api('/api/local-dirs');
    const sel = document.getElementById('save-subdir');
    sel.innerHTML = '<option value="">— Root directory —</option>' +
      (data.dirs || []).map(d => `<option value="${x(d)}">${x(d)}</option>`).join('');
  } catch {}
  const stemRow = document.getElementById('save-stem').closest('.form-row');
  const title = document.querySelector('#save-modal h2');
  if (allVersions) {
    stemRow.style.display = 'none';
    title.textContent = `Download All Versions (${(_curModel?.modelVersions || []).length})`;
  } else {
    stemRow.style.display = '';
    title.textContent = 'Save Location';
  }
  document.getElementById('save-modal').style.display = 'flex';
}

async function downloadSelected() {
  if (!_curModel || !_curVersion) return;
  const f = getFile();
  const url = f?.downloadUrl || `https://civitai.com/api/download/models/${_curVersion.id}`;
  _pendingDownload = { url, f };
  _downloadAllMode = false;
  document.getElementById('save-stem').value = f?.name ? f.name.replace(/\.[^.]+$/, '') : '';
  await _openSaveModal(false);
}

async function downloadAllVersions() {
  if (!_curModel) return;
  _pendingDownload = { allVersions: true };
  _downloadAllMode = true;
  await _openSaveModal(true);
}

function closeSaveModal() {
  document.getElementById('save-modal').style.display = 'none';
  _pendingDownload = null;
  _downloadAllMode = false;
  document.getElementById('save-stem').closest('.form-row').style.display = '';
  document.querySelector('#save-modal h2').textContent = 'Save Location';
}

async function confirmSave() {
  if (!_pendingDownload || !_curModel) return;
  const subdir = document.getElementById('save-subdir').value;

  if (_downloadAllMode) {
    closeSaveModal();
    await _batchDownloadVersions(subdir);
    return;
  }

  if (!_curVersion) return;
  const stem = document.getElementById('save-stem').value.trim();
  const { url, f } = _pendingDownload;
  closeSaveModal();
  try {
    const res = await api('/api/download', {
      method: 'POST',
      body: JSON.stringify({ url, model: _curModel, version: _curVersion, file: f, subdir, stem }),
    });
    pollDownload(res.id);
  } catch (e) {
    setStatus('Download failed: ' + e.message);
  }
}

async function _batchDownloadVersions(subdir) {
  const versions = _curModel.modelVersions || [];
  const total = versions.length;
  let done = 0, failed = 0;
  for (const v of versions) {
    const files = v.files || [];
    const primary = files.find(f => f.primary) || files[0] || null;
    const url = primary?.downloadUrl || `https://civitai.com/api/download/models/${v.id}`;
    const stem = (v.name || `v${v.id}`).replace(/[^\w\- ]/g, '_').replace(/\s+/g, '_').slice(0, 60);
    setStatus(`Queuing ${done + 1}/${total}: ${v.name || v.id}…`);
    try {
      const res = await api('/api/download', {
        method: 'POST',
        body: JSON.stringify({ url, model: _curModel, version: v, file: primary, subdir, stem }),
      });
      await _waitForDownload(res.id, done + 1, total, v.name || `v${v.id}`);
      done++;
    } catch (e) {
      failed++;
      setStatus(`Failed (${v.name || v.id}): ${e.message} — continuing…`);
    }
  }
  setStatus(`Batch complete: ${done}/${total} versions downloaded${failed ? `, ${failed} failed` : ''}`);
}

function _waitForDownload(dlId, current, total, label) {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const d = await api('/api/download/' + dlId);
        if (d.status === 'downloading' && d.total > 0) {
          const pct = Math.round(d.downloaded * 100 / d.total);
          setStatus(`Version ${current}/${total} — ${label}: ${pct}%`);
        } else if (d.status === 'done') {
          clearInterval(iv); resolve();
        } else if (d.status === 'error') {
          clearInterval(iv); reject(new Error(d.error));
        } else if (d.status === 'cancelled') {
          clearInterval(iv); reject(new Error('cancelled'));
        }
      } catch (e) { clearInterval(iv); reject(e); }
    }, 800);
  });
}

async function saveInfoOnly() {
  if (!_curModel) return;
  try {
    await api('/api/save-info', {
      method: 'POST',
      body: JSON.stringify({ model: _curModel, version: _curVersion }),
    });
    setStatus('Info JSON updated');
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
}

function pollDownload(dlId) {
  const wrap = document.getElementById('dl-wrap');
  if (wrap) wrap.style.display = 'block';
  const iv = setInterval(async () => {
    try {
      const d = await api('/api/download/' + dlId);
      const bar = document.getElementById('dl-bar');
      const label = document.getElementById('dl-label');
      if (d.status === 'downloading' && d.total > 0) {
        const pct = Math.round(d.downloaded * 100 / d.total);
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = `${pct}% — ${(d.downloaded/1048576).toFixed(1)} / ${(d.total/1048576).toFixed(1)} MB`;
        setStatus(`Downloading: ${pct}%`);
      } else if (d.status === 'done') {
        clearInterval(iv);
        if (bar) bar.style.width = '100%';
        if (label) label.textContent = 'Done — ' + (d.path || '');
        setStatus('Download complete');
      } else if (d.status === 'error') {
        clearInterval(iv); if (label) label.textContent = 'Error: ' + d.error;
        setStatus('Download error: ' + d.error);
      } else if (d.status === 'cancelled') {
        clearInterval(iv); if (label) label.textContent = 'Cancelled';
        setStatus('Download cancelled');
      }
    } catch { clearInterval(iv); }
  }, 800);
}

// ── Local files ────────────────────────────────────────────────────────────────

function navToDir(path) { loadLocalFiles(path); }

function renderBreadcrumb() {
  const parts = _localSubdir ? _localSubdir.split('/') : [];
  let html = parts.length
    ? '<span class="crumb-link" data-navpath="" onclick="navToDir(this.dataset.navpath)">🏠</span>'
    : '<span style="color:#aaa">🏠 Root</span>';
  parts.forEach((p, i) => {
    const path = parts.slice(0, i + 1).join('/');
    html += ' <span style="color:#555">›</span> ';
    html += (i === parts.length - 1)
      ? `<span style="color:#ddd">📁 ${x(p)}</span>`
      : `<span class="crumb-link" data-navpath="${x(path)}" onclick="navToDir(this.dataset.navpath)">📁 ${x(p)}</span>`;
  });
  return html;
}

async function loadLocalFiles(subdir) {
  if (subdir !== undefined) _localSubdir = subdir;
  try {
    const params = new URLSearchParams();
    if (_localSubdir) params.set('subdir', _localSubdir);
    const data = await api('/api/local-files?' + params);
    _localFiles = data.files || [];
    _localDirs = data.dirs || [];
    if (data.error) {
      const list = document.getElementById('local-list');
      if (list) list.innerHTML = `<div class="empty">${x(data.error)}</div>`;
      return;
    }
    renderLocalFiles();
    setStatus(`${_localFiles.length} model files found`);
  } catch (e) {
    setStatus('Error loading files: ' + e.message);
  }
}

function renderLocalFiles() {
  const list = document.getElementById('local-list');
  const bcEl = document.getElementById('local-breadcrumb');
  if (!list) return;
  if (bcEl) bcEl.innerHTML = renderBreadcrumb();

  const q = (document.getElementById('local-search')?.value || '').toLowerCase();
  const sort = document.getElementById('local-sort')?.value || 'name-asc';

  const dirsHtml = _localDirs.map(d =>
    `<div class="file-item dir-item" data-navpath="${x(d.path)}" onclick="navToDir(this.dataset.navpath)">
      <div class="fname">📁 ${x(d.name)}</div>
    </div>`
  ).join('');

  let files = _localFiles.map((f, i) => ({ ...f, _i: i }));
  if (q) files = files.filter(f => f.name.toLowerCase().includes(q));
  files.sort((a, b) => {
    if (sort === 'name-asc')  return a.name.localeCompare(b.name);
    if (sort === 'name-desc') return b.name.localeCompare(a.name);
    if (sort === 'size-desc') return b.size - a.size;
    if (sort === 'size-asc')  return a.size - b.size;
    if (sort === 'type-asc')  return (a.name.split('.').pop()||'').localeCompare(b.name.split('.').pop()||'');
    return 0;
  });

  const filesHtml = files.length ? files.map(f => {
    const sz = f.size > 1073741824 ? (f.size/1073741824).toFixed(2)+' GB'
               : f.size > 1048576  ? (f.size/1048576).toFixed(1)+' MB'
               : (f.size/1024).toFixed(0)+' KB';
    const type = f.info?.type || f.info?.model?.type || '';
    return `<div class="file-item" id="lf-${f._i}" onclick="showLocalFile(${f._i})">
      <div class="fname">${x(f.name)}</div>
      <div class="fmeta">${sz}${type ? ' · '+x(type) : ''}</div>
    </div>`;
  }).join('') : (q
    ? `<div class="empty">No files matching "${x(q)}"</div>`
    : (!_localDirs.length ? '<div class="empty">No model files found</div>' : ''));

  list.innerHTML = dirsHtml + filesHtml;
}

function showLocalFile(idx) {
  const f = _localFiles[idx];
  if (!f) return;
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('lf-' + idx)?.classList.add('selected');
  const rp = document.getElementById('right-panel');
  if (!rp) return;

  const fmt = jsonFormat(f.info);
  const sz = f.size > 1073741824 ? (f.size/1073741824).toFixed(2)+' GB'
             : f.size > 1048576  ? (f.size/1048576).toFixed(1)+' MB'
             : (f.size/1024).toFixed(0)+' KB';

  if (fmt === 'full_model') {
    renderDetail(f.info);

    // Select the version that matches this local file by filename
    const versions = f.info.modelVersions || [];
    const fname = f.name.toLowerCase();
    const versionIdx = versions.findIndex(v =>
      (v.files || []).some(vf => (vf.name || '').toLowerCase() === fname)
    );
    if (versionIdx > 0) {
      const sel = document.getElementById('ver-sel');
      if (sel) { sel.value = versionIdx; onVersionChange(versionIdx); }
    }

    const bar = document.createElement('div');
    bar.className = 'section';
    bar.style.cssText = 'margin-bottom:12px;padding:8px 12px';
    bar.innerHTML = `<div class="section-title" style="margin-bottom:4px">Local File</div>
      <div style="font-size:13px;color:#ccc">${x(f.name)}</div>
      <div style="font-size:11px;color:#666;margin-top:2px">${x(f.path)} &middot; ${sz}</div>`;
    rp.insertBefore(bar, rp.firstChild);

    if (f.preview) {
      const imgWrap = document.getElementById('img-wrap');
      if (imgWrap) {
        const localImg = document.createElement('img');
        localImg.className = 'local-preview';
        localImg.src = '/api/local-files/image?path=' + encodeURIComponent(f.preview);
        localImg.onerror = function() { this.style.display = 'none'; };
        imgWrap.parentNode.insertBefore(localImg, imgWrap);
        imgWrap.style.display = 'none';
      }
    }

    const btnRow = rp.querySelector('.btn-row');
    if (btnRow) {
      const versionCount = (f.info.modelVersions || []).length;
      btnRow.innerHTML = `
        <button class="btn sec" onclick="viewOnSearch(${f.info.id})">🔍 View on Search</button>
        ${versionCount > 1 ? `<button class="btn sec" onclick="downloadAllVersions()">⬇ All Versions (${versionCount})</button>` : ''}
        <button class="btn sec" onclick="localRefreshMeta(${idx})">↺ Refresh Metadata</button>
        <button class="btn sec" onclick="localRedownload(${idx})">⬇ Redownload</button>
        <button class="btn sec" style="color:#f77;border-color:#633" onclick="localDelete(${idx})">🗑 Delete</button>`;
    }

    const dlWrap = document.getElementById('dl-wrap');
    if (dlWrap) {
      dlWrap.id = 'local-dl-wrap';
      const b = dlWrap.querySelector('.dl-bar');
      const l = dlWrap.querySelector('.dl-label');
      if (b) b.id = 'local-dl-bar';
      if (l) l.id = 'local-dl-label';
    }
    return;
  }

  // Fallback for other / unknown formats
  const imgHtml = f.preview
    ? `<img class="local-preview" src="/api/local-files/image?path=${encodeURIComponent(f.preview)}" alt="" onerror="this.style.display='none'">`
    : '';
  const hasIds = fmt && fmt !== 'unknown';
  const modelId = f.info ? (f.info.modelId || f.info.id) : null;
  const fmtBadge = fmt ? `<span style="font-size:11px;color:#666;margin-left:8px">[${fmt}]</span>` : '';
  const viewBtn = modelId ? `<button class="btn sec" onclick="viewOnSearch(${modelId})">🔍 View on Search</button>` : '';
  const actionBtns = hasIds ? `
    <button class="btn sec" onclick="localRedownload(${idx})">⬇ Redownload</button>
    <button class="btn sec" onclick="localRefreshMeta(${idx})">↺ Refresh Metadata</button>` : `
    <button class="btn sec" disabled>⬇ Redownload</button>
    <button class="btn sec" disabled>↺ Refresh Metadata</button>`;
  const deleteBtn = `<button class="btn sec" style="color:#f77;border-color:#633" onclick="localDelete(${idx})">🗑 Delete</button>`;

  let summaryHtml = '';
  if (f.info) {
    const info = f.info;
    const rows = [];
    const name = info.name || info.model?.name;
    const type = info.type || info.model?.type;
    const base = info.baseModel || info.base_model;
    const creator = info.creator?.username || info.creator;
    const words = (info.trainedWords || info.trained_words || []).join(', ');
    if (name) rows.push(['Model', name]);
    if (type) rows.push(['Type', type]);
    if (base) rows.push(['Base', base]);
    if (creator) rows.push(['Creator', creator]);
    if (words) rows.push(['Triggers', words]);
    if (rows.length) {
      summaryHtml = `<div class="section" style="margin-bottom:10px">
        <div class="section-title">Info</div>
        <table class="ftable"><tbody>
          ${rows.map(([k,v]) => `<tr><th style="width:70px">${x(k)}</th><td>${x(String(v))}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
  }
  const rawHtml = f.info
    ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:#666">Raw JSON</summary>
        <div class="local-info" style="margin-top:6px">${x(JSON.stringify(f.info, null, 2))}</div></details>`
    : '<div style="color:#555;font-size:13px;padding:16px 0">No .json info file found alongside this model.</div>';

  rp.innerHTML = `
    <div class="model-name">${x(f.name)}${fmtBadge}</div>
    <div class="model-meta" style="margin-bottom:10px">${sz} &middot; ${x(f.path)}</div>
    ${imgHtml}
    <div class="btn-row" style="margin-bottom:12px">${viewBtn}${actionBtns}${deleteBtn}</div>
    <div class="dl-wrap" id="local-dl-wrap">
      <div class="dl-track"><div class="dl-bar" id="local-dl-bar"></div></div>
      <div class="dl-label" id="local-dl-label"></div>
    </div>
    ${summaryHtml}${rawHtml}`;
}

function viewOnSearch(id) {
  switchTab('search');
  document.getElementById('middle-panel').style.display = 'none';
  selectModel(id);
}

function jsonFormat(info) {
  if (!info) return null;
  if ('modelVersions' in info && 'id' in info && !('modelId' in info)) return 'full_model';
  if (info.civitaiUrl) return 'ours';
  if ('modelId' in info && 'model' in info && 'files' in info) return 'civhelper_version';
  if ('modelId' in info && 'modelVersionId' in info) return 'civhelper_meta';
  return 'unknown';
}

async function localDelete(idx) {
  const f = _localFiles[idx];
  if (!f) return;
  if (!confirm(`Delete "${f.name}" and all its assets (JSON, preview image)?\n\nThis cannot be undone.`)) return;
  try {
    await api('/api/local-files/delete', { method: 'POST', body: JSON.stringify({ path: f.path }) });
    setStatus(`Deleted ${f.name}`);
    document.getElementById('right-panel').innerHTML = '<div class="placeholder">Select a file to view details</div>';
    await loadLocalFiles();
  } catch (e) { setStatus('Delete failed: ' + e.message); }
}

async function localRefreshMeta(idx) {
  const f = _localFiles[idx];
  if (!f) return;
  setStatus('Fetching fresh metadata…');
  try {
    await api('/api/local-files/refresh-meta', { method: 'POST', body: JSON.stringify({ path: f.path }) });
    setStatus('Metadata refreshed');
    await loadLocalFiles(); showLocalFile(idx);
  } catch (e) { setStatus('Error: ' + e.message); }
}

async function localRedownload(idx) {
  const f = _localFiles[idx];
  if (!f) return;
  setStatus('Starting redownload…');
  try {
    const res = await api('/api/local-files/redownload', { method: 'POST', body: JSON.stringify({ path: f.path }) });
    const wrap = document.getElementById('local-dl-wrap');
    if (wrap) wrap.style.display = 'block';
    pollLocalDownload(res.id);
  } catch (e) { setStatus('Error: ' + e.message); }
}

function pollLocalDownload(dlId) {
  const iv = setInterval(async () => {
    try {
      const d = await api('/api/download/' + dlId);
      const bar = document.getElementById('local-dl-bar');
      const label = document.getElementById('local-dl-label');
      if (d.status === 'downloading' && d.total > 0) {
        const pct = Math.round(d.downloaded * 100 / d.total);
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = `${pct}% — ${(d.downloaded/1048576).toFixed(1)} / ${(d.total/1048576).toFixed(1)} MB`;
        setStatus(`Downloading: ${pct}%`);
      } else if (d.status === 'done') {
        clearInterval(iv);
        if (bar) bar.style.width = '100%';
        if (label) label.textContent = 'Done — ' + (d.path || '');
        setStatus('Redownload complete');
        await loadLocalFiles();
      } else if (d.status === 'error') {
        clearInterval(iv); if (label) label.textContent = 'Error: ' + d.error;
        setStatus('Download error: ' + d.error);
      } else if (d.status === 'cancelled') {
        clearInterval(iv); if (label) label.textContent = 'Cancelled';
        setStatus('Cancelled');
      }
    } catch { clearInterval(iv); }
  }, 800);
}

// ── Settings ───────────────────────────────────────────────────────────────────

async function openSettings() {
  const s = await api('/api/settings');
  document.getElementById('s-key').value = s.api_key || '';
  document.getElementById('s-dir').value = s.download_dir || '';
  document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
async function saveSettings() {
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ api_key: document.getElementById('s-key').value,
                             download_dir: document.getElementById('s-dir').value }),
    });
    closeSettings(); setStatus('Settings saved');
  } catch (e) { setStatus('Failed to save settings: ' + e.message); }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function setStatus(msg) { document.getElementById('statusbar').textContent = msg; }
function x(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status}: ${t}`); }
  return r.json();
}
