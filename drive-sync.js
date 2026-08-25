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

  async function ensureFolder(){
    if(folderId) return folderId;
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
  }

  async function findFile(filename){
    const fid = await ensureFolder();
    const q = encodeURIComponent(`name='${filename}' and '${fid}' in parents and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    return (data.files && data.files[0]) || null;
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

  function autoSave(filename, getData, delay){
    if(!accessToken) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveJson(filename, getData()).catch(e => notify('error', e.message));
    }, delay || 1500);
  }

  return { trySilent, connect, disconnect, saveJson, loadJson, autoSave, onStatus, isConfigured, isConnected };
})();
