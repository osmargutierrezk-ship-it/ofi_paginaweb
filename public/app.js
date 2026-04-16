/* ═══════════════════════════════════════════════════════════
   PayFlow v4 — Frontend SPA
   Mejoras: módulo bancos, aprobación parcial, columna activo,
            banco restringido a Banrural/BAM
   ═══════════════════════════════════════════════════════════ */

const API = '';
let TOKEN  = localStorage.getItem('pf_token') || null;
let USER   = JSON.parse(localStorage.getItem('pf_user') || 'null');
let allSolicitudes = [];
let allLotes       = [];
let allUsuarios    = [];
let loteParsed     = [];

const BANCOS = ['Banrural', 'BAM'];

/* ══ INIT ═══════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  if (TOKEN && USER) bootApp();
  else showPage('page-login');
  bindEvents();
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'NAVIGATE') {
    const map = { '/aprobaciones': 'aprobaciones', '/solicitudes': 'solicitudes' };
    const view = map[e.data.url] || 'solicitudes';
    if (!el('page-app').classList.contains('hidden')) showView(view);
  }
});

function bindEvents() {
  el('btn-login').addEventListener('click', doLogin);
  el('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  el('btn-register').addEventListener('click', doRegister);
  el('btn-submit-sol').addEventListener('click', doSubmitSolicitud);
  el('btn-submit-lote')?.addEventListener('click', doSubmitLote);
  el('lote-paste')?.addEventListener('paste', () => setTimeout(parseLote, 100));
}

/* ══ SERVICE WORKER & PUSH ══════════════════════════════════ */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch(e) {}
}

async function subscribeToNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    toast('Tu navegador no soporta notificaciones push', 'err'); return false;
  }
  let perm = Notification.permission;
  if (perm === 'denied') { toast('Notificaciones bloqueadas en el navegador', 'err'); return false; }
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Permiso denegado', 'err'); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await apiGet('/api/push/vapid-key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await apiPost('/api/push/subscribe', sub.toJSON());
    localStorage.setItem('pf_push', 'on');
    updateNotifButton(true);
    toast('🔔 Notificaciones activadas', 'ok');
    return true;
  } catch(err) { toast('Error: ' + err.message, 'err'); return false; }
}

async function unsubscribeFromNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await apiPost('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    localStorage.removeItem('pf_push');
    updateNotifButton(false);
    toast('🔕 Notificaciones desactivadas', 'ok');
  } catch(err) { toast('Error: ' + err.message, 'err'); }
}

async function toggleNotifications() {
  if (localStorage.getItem('pf_push') === 'on') await unsubscribeFromNotifications();
  else await subscribeToNotifications();
}

function updateNotifButton(on) {
  document.querySelectorAll('#btn-notif,#btn-notif-top').forEach(b => {
    b.textContent = on ? '🔔' : '🔕';
  });
}

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

/* ══ AUTH ═══════════════════════════════════════════════════ */
async function doLogin() {
  const correo = v('login-correo'), contrasena = v('login-pass');
  const errEl = el('login-error');
  errEl.classList.add('hidden');
  if (!correo || !contrasena) { showAlert(errEl, 'Completa todos los campos.'); return; }
  const btn = el('btn-login');
  btn.textContent = 'Entrando…'; btn.disabled = true;
  try {
    const data = await apiPost('/api/auth/login', { correo, contrasena });
    TOKEN = data.token; USER = data.usuario;
    localStorage.setItem('pf_token', TOKEN);
    localStorage.setItem('pf_user', JSON.stringify(USER));
    bootApp();
    if (localStorage.getItem('pf_push') === 'on') setTimeout(subscribeToNotifications, 1000);
  } catch(err) { showAlert(errEl, err.message); }
  finally { btn.textContent = 'Entrar'; btn.disabled = false; }
}

async function doRegister() {
  const nombre = v('reg-nombre'), correo = v('reg-correo'), contrasena = v('reg-pass');
  const categoria = v('reg-categoria'), agencia = v('reg-agencia');
  const errEl = el('reg-error'), okEl = el('reg-success');
  errEl.classList.add('hidden'); okEl.classList.add('hidden');
  if (!nombre||!correo||!contrasena||!categoria||!agencia) { showAlert(errEl,'Completa todos los campos.'); return; }
  const btn = el('btn-register');
  btn.textContent = 'Creando…'; btn.disabled = true;
  try {
    await apiPost('/api/auth/register', { nombre, correo, contrasena, categoria, agencia });
    okEl.textContent = '¡Cuenta creada! Ahora puedes iniciar sesión.';
    okEl.classList.remove('hidden');
    setTimeout(() => showPage('page-login'), 2000);
  } catch(err) { showAlert(errEl, err.message); }
  finally { btn.textContent = 'Crear cuenta'; btn.disabled = false; }
}

function logout() {
  TOKEN = null; USER = null;
  localStorage.removeItem('pf_token'); localStorage.removeItem('pf_user'); localStorage.removeItem('pf_push');
  showPage('page-login'); el('page-app').classList.add('hidden');
}

/* ══ APP BOOT ════════════════════════════════════════════════ */
function bootApp() {
  el('page-login').classList.add('hidden');
  el('page-register').classList.add('hidden');
  el('page-app').classList.remove('hidden');
  el('user-name-sidebar').textContent = USER.nombre;
  el('user-role-sidebar').textContent = USER.categoria;
  el('user-avatar-initials').textContent = USER.nombre.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  updateNotifButton(localStorage.getItem('pf_push') === 'on');
  buildNav();
  if (USER.categoria === 'autorizador') showView('dashboard');
  else showView('solicitudes');
}

function buildNav() {
  el('sidebar-nav').innerHTML = USER.categoria === 'autorizador' ? `
    <span class="nav-section">General</span>
    <button class="nav-item" onclick="showView('dashboard')" data-view="dashboard"><span class="nav-icon">📊</span>Dashboard</button>
    <button class="nav-item" onclick="showView('bancos')" data-view="bancos"><span class="nav-icon">🏦</span>Por Banco</button>
    <span class="nav-section">Gestión</span>
    <button class="nav-item" onclick="showView('aprobaciones')" data-view="aprobaciones"><span class="nav-icon">✅</span>Aprobar Lotes</button>
    <button class="nav-item" onclick="showView('historial')" data-view="historial"><span class="nav-icon">📋</span>Historial</button>
    <button class="nav-item" onclick="showView('usuarios')" data-view="usuarios"><span class="nav-icon">👥</span>Usuarios</button>` : `
    <span class="nav-section">Solicitudes</span>
    <button class="nav-item" onclick="showView('solicitudes')" data-view="solicitudes"><span class="nav-icon">📄</span>Mis Solicitudes</button>
    <button class="nav-item" onclick="showView('nueva-solicitud')" data-view="nueva-solicitud"><span class="nav-icon">➕</span>Nueva Solicitud</button>`;
}

function showView(name) {
  if (window.innerWidth <= 768) closeSidebar();
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  el('view-' + name)?.classList.remove('hidden');
  document.querySelector(`[data-view="${name}"]`)?.classList.add('active');
  const loaders = {
    dashboard: loadDashboard,
    bancos: loadBancos,
    solicitudes: loadSolicitudes,
    aprobaciones: loadAprobaciones,
    historial: loadHistorial,
    usuarios: loadUsuarios,
    'nueva-solicitud': initNuevaSolicitud
  };
  if (loaders[name]) loaders[name]();
}

function showPage(id) {
  ['page-login','page-register','page-app'].forEach(p => el(p).classList.add('hidden'));
  el(id).classList.remove('hidden');
}

function toggleSidebar() { el('sidebar').classList.toggle('open'); el('sidebar-ov').classList.toggle('active'); }
function closeSidebar()   { el('sidebar').classList.remove('open'); el('sidebar-ov').classList.remove('active'); }
function togglePass(inputId, btn) {
  const inp = el(inputId); inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

/* ══ TABS ════════════════════════════════════════════════════ */
function switchTab(tab) {
  el('tab-individual').classList.toggle('active', tab === 'individual');
  el('tab-lote').classList.toggle('active', tab === 'lote');
  el('panel-individual').classList.toggle('hidden', tab !== 'individual');
  el('panel-lote').classList.toggle('hidden', tab !== 'lote');
}

/* ══ DASHBOARD ═══════════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const [stats, agencias] = await Promise.all([apiGet('/api/dashboard/stats'), apiGet('/api/dashboard/resumen')]);
    el('stat-total').textContent = stats.total_solicitudes;
    el('stat-pend').textContent  = stats.pendientes;
    el('stat-ok').textContent    = stats.aprobadas;
    el('stat-rej').textContent   = stats.rechazadas;
    el('stat-monto').textContent = fmt(stats.monto_aprobado);
    const tbody = el('tbody-agencias');
    tbody.innerHTML = '';
    if (!agencias.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:2rem">Sin datos</td></tr>';
      return;
    }
    agencias.forEach(r => {
      const tr = document.createElement('tr');
      tr.className = 'row-clickable';
      tr.innerHTML = `<td><strong>${esc(r.agencia)}</strong></td>
        <td class="ta-r">${r.total}</td>
        <td class="ta-r hide-xs"><span class="badge badge-pending">${r.pendientes}</span></td>
        <td class="ta-r hide-xs"><span class="badge badge-ok">${r.aprobadas}</span></td>
        <td class="ta-r hide-xs"><span class="badge badge-err">${r.rechazadas}</span></td>
        <td class="ta-r"><strong>${fmt(r.monto_total)}</strong></td>
        <td class="ta-r hide-sm" style="color:var(--green)">${fmt(r.monto_aprobado)}</td>`;
      tr.onclick = () => openAgencia(r.agencia);
      tbody.appendChild(tr);
    });
  } catch(err) { console.error(err); }
}

async function openAgencia(agencia) {
  try {
    const rows = await apiGet(`/api/dashboard/agencia/${encodeURIComponent(agencia)}`);
    el('agencia-title').textContent = `📍 ${agencia}`;
    const tbody = el('tbody-agencia-det');
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${esc(r.lba)}</td>
        <td class="hide-xs">${esc(r.descripcion)}</td><td class="hide-sm">${bancoBadge(r.banco)}</td>
        <td class="ta-r"><strong>${fmt(r.monto)}</strong></td>
        <td class="hide-xs">${r.cafe_recibido?'<span class="badge badge-cafe">☕</span>':'—'}</td>
        <td>${estadoBadge(r.aprobado)}</td>
        <td class="hide-sm" style="color:var(--gray-400);white-space:nowrap">${fmtDate(r.creado_en)}</td>`;
      tbody.appendChild(tr);
    });
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    el('view-agencia').classList.remove('hidden');
  } catch(err) { console.error(err); }
}

/* ══ BANCOS ══════════════════════════════════════════════════ */
async function loadBancos() {
  try {
    const bancos = await apiGet('/api/dashboard/bancos');
    // Cards visuales
    const cardsEl = el('bancos-cards');
    cardsEl.innerHTML = '';
    bancos.forEach(b => {
      const esBanrural = b.banco === 'Banrural';
      const montoTotal    = parseFloat(b.monto_total)    || 0;
      const montoPend     = parseFloat(b.monto_pendiente)|| 0;
      const montoAprob    = parseFloat(b.monto_aprobado) || 0;
      const montoRech     = parseFloat(b.monto_rechazado)|| 0;
      const pctAprob = montoTotal > 0 ? Math.round((montoAprob / montoTotal) * 100) : 0;
      const pctPend  = montoTotal > 0 ? Math.round((montoPend  / montoTotal) * 100) : 0;

      cardsEl.innerHTML += `
        <div class="banco-card ${esBanrural ? 'banco-banrural' : 'banco-bam'}">
          <div class="banco-card-header">
            <div class="banco-logo-wrap">
              <span class="banco-icon">${esBanrural ? '🌾' : '🏛️'}</span>
            </div>
            <div>
              <div class="banco-nombre">${esc(b.banco)}</div>
              <div class="banco-sub">${b.total_solicitudes} solicitudes</div>
            </div>
          </div>
          <div class="banco-monto-total">${fmt(montoTotal)}</div>
          <div class="banco-label">Total solicitado</div>
          <div class="banco-bar-wrap">
            <div class="banco-bar">
              <div class="banco-bar-aprob" style="width:${pctAprob}%" title="Aprobado ${pctAprob}%"></div>
              <div class="banco-bar-pend"  style="width:${pctPend}%"  title="Pendiente ${pctPend}%"></div>
            </div>
            <div class="banco-bar-legend">
              <span class="dot-aprob">● Aprobado ${pctAprob}%</span>
              <span class="dot-pend">● Pendiente ${pctPend}%</span>
            </div>
          </div>
          <div class="banco-desglose">
            <div class="banco-desglose-item">
              <span class="banco-desglose-val aprob">${fmt(montoAprob)}</span>
              <span class="banco-desglose-lbl">Aprobado</span>
            </div>
            <div class="banco-desglose-item">
              <span class="banco-desglose-val pend">${fmt(montoPend)}</span>
              <span class="banco-desglose-lbl">Pendiente</span>
            </div>
            <div class="banco-desglose-item">
              <span class="banco-desglose-val rech">${fmt(montoRech)}</span>
              <span class="banco-desglose-lbl">Rechazado</span>
            </div>
          </div>
        </div>`;
    });

    // Tabla comparativa
    const tbody = el('tbody-bancos');
    tbody.innerHTML = '';
    bancos.forEach(b => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${bancoBadge(b.banco)}</strong></td>
        <td class="ta-r"><strong>${fmt(b.monto_total)}</strong></td>
        <td class="ta-r hide-xs" style="color:var(--yellow)">${fmt(b.monto_pendiente)}</td>
        <td class="ta-r hide-xs" style="color:var(--green)">${fmt(b.monto_aprobado)}</td>
        <td class="ta-r hide-xs" style="color:var(--red)">${fmt(b.monto_rechazado)}</td>
        <td class="ta-r hide-sm"><span class="badge badge-pending">${b.pendientes}</span></td>
        <td class="ta-r hide-sm"><span class="badge badge-ok">${b.aprobadas}</span></td>`;
      tbody.appendChild(tr);
    });
  } catch(err) { console.error(err); toast('Error cargando datos de bancos', 'err'); }
}

/* ══ MIS SOLICITUDES (contador) ════════════════════════════ */
async function loadSolicitudes() {
  try {
    allSolicitudes = await apiGet('/api/solicitudes');
    renderSolicitudes(allSolicitudes);
  } catch(err) { console.error(err); }
}

function renderSolicitudes(rows) {
  const tbody = el('tbody-solicitudes');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:2rem">Sin solicitudes aún.</td></tr>';
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td>
      <td class="hide-xs">${r.lote_id ? `<span class="badge badge-info">Lote #${r.lote_id}</span>` : '—'}</td>
      <td>${esc(r.lba)}</td>
      <td class="hide-sm">${esc(r.descripcion)}</td>
      <td class="hide-sm">${bancoBadge(r.banco)}</td>
      <td class="ta-r"><strong>${fmt(r.monto)}</strong></td>
      <td class="hide-xs">${r.cafe_recibido?'<span class="badge badge-cafe">☕</span>':'—'}</td>
      <td>${estadoBadge(r.aprobado)}</td>
      <td class="hide-sm" style="color:var(--gray-400);white-space:nowrap">${fmtDate(r.creado_en)}</td>`;
    tbody.appendChild(tr);
  });
}

function filterSolicitudes() {
  const q = el('sol-search').value.toLowerCase(), e = el('sol-filter-estado').value;
  renderSolicitudes(allSolicitudes.filter(r =>
    (!q || [r.lba,r.descripcion,r.banco].some(f=>f.toLowerCase().includes(q))) &&
    (!e || estadoStr(r.aprobado) === e)
  ));
}

/* ══ NUEVA SOLICITUD ════════════════════════════════════════ */
function initNuevaSolicitud() {
  const agencia = USER.agencia;
  if (el('sol-agencia-display'))  el('sol-agencia-display').textContent  = agencia;
  if (el('lote-agencia-display')) el('lote-agencia-display').textContent = agencia;
  resetNuevaSolicitud(); clearLote(); switchTab('individual');
}

function resetNuevaSolicitud() {
  ['sol-lba','sol-desc','sol-monto'].forEach(id => { if(el(id)) el(id).value=''; });
  if(el('sol-banco')) el('sol-banco').value = '';
  if(el('sol-cafe'))  el('sol-cafe').checked = false;
  el('sol-error')?.classList.add('hidden'); el('sol-success')?.classList.add('hidden');
}

async function doSubmitSolicitud() {
  const lba=v('sol-lba'), descripcion=v('sol-desc'), banco=v('sol-banco'), monto=v('sol-monto');
  const cafe=el('sol-cafe').checked;
  const errEl=el('sol-error'), okEl=el('sol-success');
  errEl.classList.add('hidden'); okEl.classList.add('hidden');

  const missing=[];
  if(!lba) missing.push('LBA'); if(!descripcion) missing.push('Descripción');
  if(!banco) missing.push('Banco'); if(!monto) missing.push('Monto');
  if(missing.length) { showAlert(errEl,`Campos requeridos: ${missing.join(', ')}`); return; }

  if(!BANCOS.includes(banco)) { showAlert(errEl,`Banco inválido. Solo se permiten: ${BANCOS.join(', ')}`); return; }
  if(parseFloat(monto)<0) { showAlert(errEl,'El monto no puede ser negativo.'); return; }

  const btn=el('btn-submit-sol'); btn.textContent='Guardando…'; btn.disabled=true;
  try {
    await apiPost('/api/solicitudes', { lba, descripcion, cafe_recibido:cafe, banco, monto:parseFloat(monto) });
    okEl.textContent='✅ Solicitud creada exitosamente.'; okEl.classList.remove('hidden');
    resetNuevaSolicitud(); setTimeout(()=>showView('solicitudes'), 1500);
  } catch(err) { showAlert(errEl, err.message); }
  finally { btn.textContent='Guardar'; btn.disabled=false; }
}

/* ══ LOTE PASTE ═════════════════════════════════════════════ */
function parseLote() {
  const raw = el('lote-paste').value.trim();
  if (!raw) return;
  const lines = raw.split('\n').filter(l=>l.trim());
  const errors=[], valid=[];
  lines.forEach((line,i) => {
    const cols = line.split(/\t|;/);
    if(cols.length<4) { errors.push({ fila: i+1, motivo: 'Columnas insuficientes' }); return; }
    const lba=cols[0]?.trim(), descripcion=cols[1]?.trim(), banco=cols[2]?.trim();
    const monto=parseFloat(cols[3]?.trim().replace(/[,\s]/g,''));
    const cafe=cols[4]?.trim()==='1'||cols[4]?.trim()?.toLowerCase()==='si';
    if(!lba||!descripcion) { errors.push({ fila: i+1, motivo: 'LBA o descripción vacío' }); return; }
    if(!BANCOS.includes(banco)) { errors.push({ fila: i+1, motivo: `Banco "${banco}" no permitido` }); return; }
    if(isNaN(monto)||monto<0) { errors.push({ fila: i+1, motivo: 'Monto inválido' }); return; }
    valid.push({ lba, descripcion, banco, monto, cafe_recibido:cafe, _ok:true });
  });
  loteParsed = valid;
  const tbody=el('tbody-preview'); tbody.innerHTML='';
  let total=0, vi=0;
  const errorFilas=errors.map(e=>e.fila);
  lines.forEach((line,i) => {
    const isOk=!errorFilas.includes(i+1);
    const d=isOk?valid[vi]:null; if(isOk){total+=d.monto;vi++;}
    const errMotivo=errors.find(e=>e.fila===i+1)?.motivo||'';
    const tr=document.createElement('tr');
    tr.innerHTML=isOk
      ?`<td>${i+1}</td><td>${esc(d.lba)}</td><td>${esc(d.descripcion)}</td><td>${bancoBadge(d.banco)}</td>
         <td class="ta-r">${fmt(d.monto)}</td><td>${d.cafe_recibido?'<span class="badge badge-cafe">☕</span>':'—'}</td>
         <td><span class="badge badge-valid">✓ OK</span></td>`
      :`<td>${i+1}</td><td colspan="4" style="color:var(--red);font-size:.85em">${esc(errMotivo)} — ${esc(line.substring(0,50))}</td>
         <td></td><td><span class="badge badge-invalid">✕ Error</span></td>`;
    tbody.appendChild(tr);
  });
  el('preview-count').textContent=`${valid.length} filas válidas${errors.length?`, ${errors.length} con error`:''}`;
  el('preview-total').textContent=`Total: ${fmt(total)}`;
  el('lote-preview').classList.remove('hidden');
  el('btn-submit-lote').classList.toggle('hidden', valid.length===0);
  const errEl=el('lote-error');
  if(errors.length) {
    const msgs=errors.map(e=>`Fila ${e.fila}: ${e.motivo}`).join(' | ');
    showAlert(errEl,`⚠ Filas con error (se omitirán): ${msgs}`);
  } else errEl.classList.add('hidden');
}

function clearLote() {
  if(el('lote-paste')) el('lote-paste').value='';
  el('lote-preview')?.classList.add('hidden');
  el('btn-submit-lote')?.classList.add('hidden');
  el('lote-error')?.classList.add('hidden');
  el('lote-success')?.classList.add('hidden');
  loteParsed=[];
}

async function doSubmitLote() {
  if(!loteParsed.length) { toast('No hay filas válidas','err'); return; }
  const btn=el('btn-submit-lote'); btn.textContent=`Enviando ${loteParsed.length} solicitudes…`; btn.disabled=true;
  const errEl=el('lote-error'), okEl=el('lote-success');
  errEl.classList.add('hidden'); okEl.classList.add('hidden');
  try {
    const res=await apiPost('/api/solicitudes/bulk', { solicitudes:loteParsed });
    okEl.textContent=`✅ ${res.insertados} solicitudes enviadas en el Lote #${res.lote.id}.`;
    okEl.classList.remove('hidden'); clearLote();
    setTimeout(()=>showView('solicitudes'), 2000);
  } catch(err) { showAlert(errEl, err.message); }
  finally { btn.textContent='📤 Enviar lote'; btn.disabled=false; }
}

/* ══ APROBACIONES — LOTES ACORDEÓN ═════════════════════════ */
async function loadAprobaciones() {
  try {
    allLotes = await apiGet('/api/solicitudes/lotes');
    populateAgenciaFilterLotes(allLotes);
    renderLotes(allLotes);
  } catch(err) { console.error(err); }
}

function populateAgenciaFilterLotes(lotes) {
  const sel=el('apr-filter-agencia');
  const agencias=[...new Set(lotes.map(l=>l.agencia))].sort();
  sel.innerHTML='<option value="">Todas las agencias</option>';
  agencias.forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; sel.appendChild(o); });
}

function filterAprobaciones() {
  const q=el('apr-search').value.toLowerCase();
  const e=el('apr-filter-estado').value;
  const a=el('apr-filter-agencia').value;
  renderLotes(allLotes.filter(l=>
    (!q||[l.descripcion,l.agencia,l.creado_por_nombre,String(l.id)].some(f=>f?.toLowerCase().includes(q)))&&
    (!e||estadoStr(l.aprobado)===e)&&
    (!a||l.agencia===a)
  ));
}

function renderLotes(lotes) {
  const container=el('lotes-container');
  container.innerHTML='';
  if(!lotes.length) {
    container.innerHTML=`<div class="card"><div class="lote-empty">Sin lotes de solicitudes</div></div>`;
    return;
  }
  lotes.forEach(lote => {
    const estado=estadoStr(lote.aprobado);
    const isPend=lote.aprobado===null;
    const card=document.createElement('div');
    card.className=`lote-card ${estado}`;
    card.dataset.id=lote.id;

    const montoTotal=parseFloat(lote.monto_total)||0;
    const montoAprobado=lote.monto_aprobado!=null?parseFloat(lote.monto_aprobado):null;
    const esParcial=montoAprobado!=null && lote.aprobado && montoAprobado<montoTotal;

    // Agrupar bancos dentro del lote
    const bancosLote={};
    (lote.solicitudes||[]).forEach(s=>{
      if(!bancosLote[s.banco]) bancosLote[s.banco]={count:0,monto:0};
      bancosLote[s.banco].count++;
      bancosLote[s.banco].monto+=parseFloat(s.monto)||0;
    });
    const bancosHtml=Object.entries(bancosLote).map(([b,d])=>
      `<span class="banco-pill ${b==='Banrural'?'pill-banrural':'pill-bam'}">${b}: ${fmt(d.monto)}</span>`
    ).join('');

    card.innerHTML=`
      <div class="lote-header" onclick="toggleLote(${lote.id})">
        <span class="lote-chevron">▶</span>
        <div class="lote-info">
          <div class="lote-title">Lote #${lote.id} — ${esc(lote.agencia)}</div>
          <div class="lote-meta">
            <span>📦 <strong>${lote.total_solicitudes}</strong> solicitudes</span>
            <span>👤 ${esc(lote.creado_por_nombre||'—')}</span>
            <span>📅 ${fmtDate(lote.creado_en)}</span>
          </div>
          ${bancosHtml?`<div class="lote-bancos">${bancosHtml}</div>`:''}
        </div>
        <div class="lote-right">
          <span class="lote-monto">${fmt(montoTotal)}</span>
          ${esParcial?`<span class="lote-monto-aprob">✓ ${fmt(montoAprobado)} aprobado</span>`:''}
          ${estadoBadge(lote.aprobado)}
          ${isPend ? `
            <div class="lote-actions-btns" onclick="event.stopPropagation()">
              <button class="btn btn-success btn-sm" onclick="openAprobarLoteModal(${lote.id},'aprobado',${montoTotal})">✓ Aprobar</button>
              <button class="btn btn-danger  btn-sm" onclick="openAprobarLoteModal(${lote.id},'rechazado',${montoTotal})">✕ Rechazar</button>
            </div>` : ''}
        </div>
      </div>
      <div class="lote-body">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>LBA</th><th class="hide-xs">Descripción</th>
              <th>Banco</th><th class="ta-r">Monto</th><th class="hide-xs">Café</th>
            </tr></thead>
            <tbody>
              ${(lote.solicitudes||[]).map(s=>`
                <tr>
                  <td>${s.id}</td>
                  <td>${esc(s.lba)}</td>
                  <td class="hide-xs">${esc(s.descripcion)}</td>
                  <td>${bancoBadge(s.banco)}</td>
                  <td class="ta-r"><strong>${fmt(s.monto)}</strong></td>
                  <td class="hide-xs">${s.cafe_recibido?'<span class="badge badge-cafe">☕</span>':'—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function toggleLote(id) {
  const card=document.querySelector(`.lote-card[data-id="${id}"]`);
  if(card) card.classList.toggle('open');
}

function openAprobarLoteModal(loteId, accion, montoTotal) {
  const isAp=accion==='aprobado';
  el('modal-title').textContent=isAp?'✅ Aprobar Lote':'❌ Rechazar Lote';
  el('modal-body').innerHTML=`
    <p style="margin-bottom:.75rem">
      ${isAp
        ?`¿Confirmas la <strong>aprobación</strong> del Lote <strong>#${loteId}</strong>?`
        :`¿Confirmas el <strong>rechazo</strong> del Lote <strong>#${loteId}</strong> y todas sus solicitudes?`}
    </p>
    ${isAp ? `
    <div class="monto-info-box">
      <span class="monto-label">Monto total del lote:</span>
      <span class="monto-total-val">${fmt(montoTotal)}</span>
    </div>
    <div class="field" style="margin-top:.75rem">
      <label>💰 Monto a aprobar <small style="color:var(--gray-400)">(opcional — vacío = aprobar total)</small></label>
      <input id="modal-monto-aprob" type="number" min="0" max="${montoTotal}" step="0.01"
             placeholder="Dejar vacío para aprobar todo (${fmt(montoTotal)})"
             inputmode="decimal"
             oninput="validarMontoModal(${montoTotal})" />
      <div id="modal-monto-hint" style="font-size:.8rem;margin-top:.25rem;color:var(--gray-400)">
        Puedes ingresar un monto menor si solo apruebas parcialmente.
      </div>
    </div>` : ''}
    <div class="field" style="margin-top:.75rem"><label>Observación (opcional)</label>
    <textarea id="modal-detalle" rows="3" placeholder="Agrega un comentario…"></textarea></div>`;
  el('modal-footer').innerHTML=`
    <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
    <button class="btn ${isAp?'btn-success':'btn-danger'}" id="btn-confirm-apr"
      onclick="submitAprobarLote(${loteId},'${accion}',${montoTotal})">
      ${isAp?'Confirmar aprobación':'Confirmar rechazo'}
    </button>`;
  el('modal-overlay').classList.remove('hidden');
}

function validarMontoModal(montoMax) {
  const inp=el('modal-monto-aprob');
  const hint=el('modal-monto-hint');
  const btn=el('btn-confirm-apr');
  const val=parseFloat(inp.value);
  if(inp.value===''||inp.value===null) {
    hint.textContent='Aprobar total: '+fmt(montoMax);
    hint.style.color='var(--gray-400)';
    inp.style.borderColor='';
    if(btn) btn.disabled=false;
    return;
  }
  if(isNaN(val)||val<0) {
    hint.textContent='⚠ Monto inválido';
    hint.style.color='var(--red)';
    inp.style.borderColor='var(--red)';
    if(btn) btn.disabled=true;
    return;
  }
  if(val>montoMax) {
    hint.textContent=`⚠ No puede superar el total (${fmt(montoMax)})`;
    hint.style.color='var(--red)';
    inp.style.borderColor='var(--red)';
    if(btn) btn.disabled=true;
    return;
  }
  const diff=montoMax-val;
  hint.textContent=`✓ Se aprobará ${fmt(val)} — diferencia de ${fmt(diff)} no aprobada`;
  hint.style.color=val<montoMax?'var(--yellow)':'var(--green)';
  inp.style.borderColor=val<montoMax?'var(--yellow)':'var(--green)';
  if(btn) btn.disabled=false;
}

async function submitAprobarLote(loteId, accion, montoTotal) {
  const detalle=el('modal-detalle')?.value.trim();
  const montoInp=el('modal-monto-aprob');
  let monto_aprobado=undefined;
  if(montoInp && montoInp.value!=='') {
    monto_aprobado=parseFloat(montoInp.value);
    if(isNaN(monto_aprobado)||monto_aprobado<0||monto_aprobado>montoTotal) {
      toast('Monto aprobado inválido','err'); return;
    }
  }
  try {
    const res=await apiPost('/api/aprobaciones', { lote_id: loteId, accion, detalle, monto_aprobado });
    closeModal();
    if(accion==='aprobado') {
      const esParcial=res.monto_aprobado!=null && res.monto_aprobado<res.monto_total;
      toast(esParcial
        ?`✅ Aprobado parcialmente: ${fmt(res.monto_aprobado)} de ${fmt(res.monto_total)}`
        :`✅ Lote aprobado por ${fmt(res.monto_aprobado)}`
      ,'ok');
    } else {
      toast('❌ Lote rechazado','err');
    }
    await loadAprobaciones();
  } catch(err) { toast(err.message,'err'); }
}

/* ══ HISTORIAL ═══════════════════════════════════════════════ */
async function loadHistorial() {
  try {
    const rows=await apiGet('/api/aprobaciones');
    const tbody=el('tbody-historial'); tbody.innerHTML='';
    if(!rows.length) {
      tbody.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:2rem">Sin acciones</td></tr>';
      return;
    }
    rows.forEach(r=>{
      const tr=document.createElement('tr');
      const montoAprob=r.monto_aprobado!=null?fmt(r.monto_aprobado):'—';
      tr.innerHTML=`<td><strong>Lote #${r.lote_id}</strong></td>
        <td class="hide-xs">${esc(r.agencia||'—')}</td>
        <td class="hide-sm" style="max-width:180px">${esc(r.lote_descripcion||'—')}</td>
        <td>${r.accion==='aprobado'?'<span class="badge badge-ok">✓ Aprobado</span>':'<span class="badge badge-err">✕ Rechazado</span>'}</td>
        <td class="hide-xs" style="color:var(--green);font-weight:600">${montoAprob}</td>
        <td class="hide-sm">${esc(r.usuario_nombre)}</td>
        <td class="hide-sm" style="color:var(--gray-400)">${r.detalle?esc(r.detalle):'—'}</td>
        <td class="hide-sm" style="color:var(--gray-400);white-space:nowrap">${fmtDate(r.fecha_hora)}</td>`;
      tbody.appendChild(tr);
    });
  } catch(err) { console.error(err); }
}

/* ══ USUARIOS — GESTIÓN ACTIVO ══════════════════════════════ */
async function loadUsuarios() {
  try {
    allUsuarios = await apiGet('/api/usuarios');
    renderUsuarios(allUsuarios);
  } catch(err) { console.error(err); toast('Error cargando usuarios', 'err'); }
}

function renderUsuarios(rows) {
  const tbody=el('tbody-usuarios');
  tbody.innerHTML='';
  if(!rows.length) {
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:2rem">Sin usuarios</td></tr>';
    return;
  }
  rows.forEach(u => {
    const esSelf=u.id===USER.id;
    const activo=u.activo;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>
        <div style="display:flex;align-items:center;gap:.5rem">
          <div class="mini-avatar" style="background:${activo?'var(--accent)':'var(--gray-600)'}">${esc(u.nombre.slice(0,2).toUpperCase())}</div>
          <div>
            <strong>${esc(u.nombre)}</strong>
            ${esSelf?'<span class="badge badge-info" style="margin-left:.3rem">Tú</span>':''}
          </div>
        </div>
      </td>
      <td class="hide-xs" style="color:var(--gray-400);font-size:.85rem">${esc(u.correo)}</td>
      <td><span class="badge ${u.categoria==='autorizador'?'badge-autorizador':'badge-contador'}">${u.categoria}</span></td>
      <td class="hide-sm">${esc(u.agencia)}</td>
      <td>
        ${activo
          ?'<span class="badge badge-ok">● Activo</span>'
          :'<span class="badge badge-err">● Inactivo</span>'}
      </td>
      <td>
        ${esSelf
          ? '<span style="color:var(--gray-500);font-size:.8rem">—</span>'
          : `<button class="btn btn-sm ${activo?'btn-outline':'btn-success'}"
               onclick="toggleActivoUsuario(${u.id},${!activo},'${esc(u.nombre)}')">
               ${activo?'🧳 De viaje':'✅ Reactivar'}
             </button>`}
      </td>`;
    tbody.appendChild(tr);
  });
}

function filterUsuarios() {
  const q=el('usr-search').value.toLowerCase();
  const cat=el('usr-filter-cat').value;
  const est=el('usr-filter-activo').value;
  renderUsuarios(allUsuarios.filter(u=>
    (!q||[u.nombre,u.agencia,u.correo].some(f=>f.toLowerCase().includes(q)))&&
    (!cat||u.categoria===cat)&&
    (!est||(est==='activo'?u.activo:!u.activo))
  ));
}

async function toggleActivoUsuario(userId, nuevoActivo, nombre) {
  const accion=nuevoActivo?'reactivar':'marcar como de viaje (desactivar)';
  if(!confirm(`¿Deseas ${accion} a "${nombre}"?`)) return;
  try {
    const res=await apiPatch(`/api/usuarios/${userId}/activo`, { activo: nuevoActivo });
    toast(res.message,'ok');
    await loadUsuarios();
  } catch(err) { toast(err.message,'err'); }
}

/* ══ MODAL ═══════════════════════════════════════════════════ */
function closeModal(e) {
  if(e&&e.target!==el('modal-overlay')) return;
  el('modal-overlay').classList.add('hidden');
}

/* ══ TOAST ═══════════════════════════════════════════════════ */
function toast(msg, type='ok') {
  const t=document.createElement('div');
  t.className=`toast toast-${type}`; t.textContent=msg;
  el('toast-container').appendChild(t);
  setTimeout(()=>{ t.style.animation='toastOut .3s ease forwards'; setTimeout(()=>t.remove(),300); },3500);
}

/* ══ HELPERS ═════════════════════════════════════════════════ */
function estadoStr(a) { return a===null||a===undefined?'pendiente':a?'aprobado':'rechazado'; }
function estadoBadge(a) {
  const s=estadoStr(a);
  return s==='pendiente'?'<span class="badge badge-pending">⏳ Pendiente</span>'
        :s==='aprobado' ?'<span class="badge badge-ok">✓ Aprobado</span>'
                        :'<span class="badge badge-err">✕ Rechazado</span>';
}
function bancoBadge(banco) {
  if(!banco) return '—';
  const cls=banco==='Banrural'?'pill-banrural':'pill-bam';
  return `<span class="banco-pill ${cls}">${esc(banco)}</span>`;
}
const fmt     = n => new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ',minimumFractionDigits:2}).format(parseFloat(n)||0);
const fmtDate = s => s?new Date(s).toLocaleDateString('es-GT',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const esc     = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const el      = id => document.getElementById(id);
const v       = id => el(id)?.value?.trim()||'';
const showAlert = (el,msg) => { el.textContent=msg; el.classList.remove('hidden'); };

async function apiFetch(url, opts={}) {
  const headers={'Content-Type':'application/json',...opts.headers};
  if(TOKEN) headers['Authorization']=`Bearer ${TOKEN}`;
  const res=await fetch(API+url,{...opts,headers});
  const data=await res.json().catch(()=>({error:'Respuesta inválida'}));
  if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}
const apiGet   = url    => apiFetch(url);
const apiPost  = (url,b)=> apiFetch(url,{method:'POST',  body:JSON.stringify(b)});
const apiPatch = (url,b)=> apiFetch(url,{method:'PATCH', body:JSON.stringify(b)});
