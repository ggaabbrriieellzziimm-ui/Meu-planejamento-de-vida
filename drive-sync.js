/* ============================================================
   DriveSync — sincronização automática com o Google Drive
   Usado pelos 3 apps (rotina.html, financas.html, treino.html)

   Como funciona:
   - Usa o Google Identity Services (OAuth) para pedir acesso
     só aos arquivos que ESTE app cria (escopo drive.file — não
     enxerga o resto do seu Drive).
   - Cria uma pasta "Meu Planejamento de Vida" no seu Drive e
     salva ali um arquivo .json por app.
   - Depois do primeiro login, tenta reconectar sozinho (modo
     silencioso) toda vez que o app abre — mesmo depois de
     limpar o cache do navegador, porque a autorização fica
     guardada na sua conta Google, não no navegador.

   IMPORTANTE: troque GOOGLE_CLIENT_ID abaixo pela sua chave
   gerada no Google Cloud Console (veja instruções no README).
   ============================================================ */

window.DriveSync = (function(){
  const GOOGLE_CLIENT_ID = '844921305729-o4cvqbg3206ro96uc6pdaa1p70r1ipaf.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'Meu Planejamento de Vida';

  let tokenClient = null;
  let accessToken = null;
  let folderId = null;
  let saveTimer = null;
  let pendingFilename = null;
  let pendingGetData = null;
  const listeners = [];

  function notify(status, detail){ listeners.forEach(fn => { try{ fn(status, detail); }catch(e){} }); }
  function onStatus(fn){ listeners.push(fn); }

  function isConfigured(){
    return !!GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.indexOf('COLE_AQUI') !== 0;
  }
  function isConnected(){ return !!accessToken; }

  function loadGis(cb){
    if(window.google && window.google.accounts && window.google.accounts.oauth2){ cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = cb;
    s.onerror = () => notify('error', 'Sem conexão com o Google (verifique a internet)');
    document.head.appendChild(s);
  }

  function ensureTokenClient(callback){
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback
    });
    return tokenClient;
  }

  function trySilent(){
    if(!isConfigured()) return;
    loadGis(() => {
      ensureTokenClient((resp) => {
        if(resp && resp.access_token){
          accessToken = resp.access_token;
          notify('connected');
        }
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function connect(){
    if(!isConfigured()){ notify('unconfigured'); return; }
    loadGis(() => {
      ensureTokenClient((resp) => {
        if(resp.error){ notify('error', resp.error); return; }
        accessToken = resp.access_token;
        notify('connected');
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  function disconnect(){
    if(accessToken && window.google && google.accounts && google.accounts.oauth2){
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    folderId = null;
    notify('disconnected');
  }

  async function api(url, options){
    options = options || {};
    options.keepalive = true;
    options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + accessToken });
    const res = await fetch(url, options);
    if(res.status === 401){ accessToken = null; notify('expired'); throw new Error('Sessão expirada'); }
    if(!res.ok){
      let detail = '';
      try{ const body = await res.json(); detail = body && body.error && body.error.message ? body.error.message : ''; }catch(e){}
      throw new Error('Drive API ' + res.status + (detail ? ' — ' + detail : ''));
    }
    return res;
  }

  let folderPromise = null;
  async function ensureFolder(){
    if(folderId) return folderId;
    if(folderPromise) return folderPromise;
    folderPromise = (async () => {
      const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await res.json();
      if(data.files && data.files.length){ folderId = data.files[0].id; return folderId; }
      const created = await api('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
      });
      const j = await created.json();
      folderId = j.id;
      return folderId;
    })();
    try{ return await folderPromise; } finally { folderPromise = null; }
  }

  async function findFile(filename){
    const fid = await ensureFolder();
    const q = encodeURIComponent(`name='${filename}' and '${fid}' in parents and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    const files = data.files || [];
    if(!files.length) return null;
    // Se por algum motivo existir mais de um arquivo com o mesmo nome (ex: falha de rede antiga),
    // usa sempre o mais recente e apaga os duplicados mais antigos pra não confundir de novo.
    files.sort((a,b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
    if(files.length > 1){
      for(let i=1;i<files.length;i++){
        api(`https://www.googleapis.com/drive/v3/files/${files[i].id}`, { method:'DELETE' }).catch(()=>{});
      }
    }
    return files[0];
  }

  async function saveJson(filename, obj){
    if(!accessToken) return false;
    const fid = await ensureFolder();
    const existing = await findFile(filename);
    const boundary = 'planeja-' + Math.random().toString(36).slice(2);
    const metadata = { name: filename, mimeType: 'application/json' };
    if(!existing) metadata.parents = [fid];
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
    const url = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    await api(url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    notify('saved');
    return true;
  }

  async function loadJson(filename){
    if(!accessToken) return null;
    const file = await findFile(filename);
    if(!file) return null;
    const res = await api(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    return await res.json();
  }

  /* ---------------------------------------------------------------
     Armazenamento "tipo bloco de notas": cada item (ex: cada ordem
     de serviço) vira UM ARQUIVO PRÓPRIO dentro de uma subpasta.
     Escrever um item nunca toca no arquivo de outro item — então é
     fisicamente impossível uma anotação sobrescrever outra.
     --------------------------------------------------------------- */
  const subfolderCache = {};
  let subfolderPromises = {};
  async function ensureSubfolder(name){
    if(subfolderCache[name]) return subfolderCache[name];
    if(subfolderPromises[name]) return subfolderPromises[name];
    subfolderPromises[name] = (async () => {
      const parent = await ensureFolder();
      const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`);
      const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await res.json();
      if(data.files && data.files.length){ subfolderCache[name] = data.files[0].id; return subfolderCache[name]; }
      const created = await api('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] })
      });
      const j = await created.json();
      subfolderCache[name] = j.id;
      return j.id;
    })();
    try{ return await subfolderPromises[name]; } finally { delete subfolderPromises[name]; }
  }

  async function findItemFile(folderId, itemId){
    const q = encodeURIComponent(`name='${itemId}.json' and '${folderId}' in parents and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    const files = data.files || [];
    if(!files.length) return null;
    files.sort((a,b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
    if(files.length > 1){
      for(let i=1;i<files.length;i++){
        api(`https://www.googleapis.com/drive/v3/files/${files[i].id}`, { method:'DELETE' }).catch(()=>{});
      }
    }
    return files[0];
  }

  // Fila por item: duas edições da MESMA anotação nunca rodam ao mesmo tempo,
  // mas anotações diferentes podem subir em paralelo sem nenhum conflito,
  // já que cada uma mexe só no próprio arquivo.
  const itemQueues = {};
  function queueItemTask(key, task){
    const prev = itemQueues[key] || Promise.resolve();
    const next = prev.then(task, task);
    itemQueues[key] = next.catch(() => {});
    return next;
  }

  function saveItem(subfolderName, itemId, obj){
    const key = subfolderName + ':' + itemId;
    return queueItemTask(key, async () => {
      if(!accessToken) return false;
      const folderId = await ensureSubfolder(subfolderName);
      const existing = await findItemFile(folderId, itemId);
      const filename = itemId + '.json';
      const boundary = 'planeja-' + Math.random().toString(36).slice(2);
      const metadata = { name: filename, mimeType: 'application/json' };
      if(!existing) metadata.parents = [folderId];
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
      const url = existing
        ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      await api(url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      notify('item-saved', itemId);
      return true;
    }).catch(e => { notify('error', e.message); return false; });
  }

  function deleteItem(subfolderName, itemId){
    const key = subfolderName + ':' + itemId;
    return queueItemTask(key, async () => {
      if(!accessToken) return false;
      const folderId = await ensureSubfolder(subfolderName);
      const existing = await findItemFile(folderId, itemId);
      if(existing) await api(`https://www.googleapis.com/drive/v3/files/${existing.id}`, { method: 'DELETE' });
      return true;
    }).catch(e => { notify('error', e.message); return false; });
  }

  async function loadAllItems(subfolderName){
    if(!accessToken) return [];
    const folderId = await ensureSubfolder(subfolderName);
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`);
    const data = await res.json();
    const files = data.files || [];
    const results = await Promise.all(files.map(async (f) => {
      try{
        const r = await api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
        return await r.json();
      }catch(e){ return null; }
    }));
    return results.filter(Boolean);
  }

  // Fila serializada: nunca deixa dois envios acontecerem ao mesmo tempo.
  // Se uma alteração chegar enquanto outra ainda está subindo, ela espera
  // a atual terminar e então sobe a versão mais recente (nunca a do meio).
  let saving = false;
  let savePending = false;

  function autoSave(filename, getData, delay){
    if(!accessToken) return;
    pendingFilename = filename;
    pendingGetData = getData;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flush(); }, delay || 800);
  }

  function flush(){
    if(!accessToken || !pendingGetData) return;
    clearTimeout(saveTimer);
    if(saving){
      savePending = true;
      return;
    }
    const filename = pendingFilename;
    const data = pendingGetData();
    pendingGetData = null;
    saving = true;
    saveJson(filename, data)
      .catch(e => notify('error', e.message))
      .finally(() => {
        saving = false;
        if(savePending){
          savePending = false;
          flush();
        }
      });
  }

  return { trySilent, connect, disconnect, saveJson, loadJson, saveItem, deleteItem, loadAllItems, autoSave, flush, onStatus, isConfigured, isConnected };
})();

// Garante que uma alteração recente não se perca ao sair da tela ou trocar de aba
document.addEventListener('visibilitychange', () => {
  if(document.hidden) window.DriveSync.flush();
});
window.addEventListener('pagehide', () => window.DriveSync.flush());
