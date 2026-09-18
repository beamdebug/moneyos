const DB_NAME = 'moneyos-db', DB_VERSION = 1;
const defaultCategories = [
  ['อาหาร','🍜','expense'],['เดินทาง','🚗','expense'],['ของใช้','🛒','expense'],['ความบันเทิง','🎮','expense'],['ที่พัก','🏠','expense'],['ค่าโทรศัพท์/อินเทอร์เน็ต','📱','expense'],['การศึกษา','🎓','expense'],['บิล/ค่าใช้จ่ายประจำ','💳','expense'],['การลงทุน','📈','expense'],['อื่น ๆ','📦','expense'],['เงินเดือน','💰','income'],['รายได้เสริม','✨','income']
];
let db, state = { view:'dashboard', month:currentMonth(), type:'expense', range:3, editTransaction:null };
let cache = { transactions:[], categories:[], budgets:[], goals:[], portfolio:[], summaries:[] };
const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(Number(n||0));
const fullMoney = n => `${Number(n)<0?'-':''}฿${money(Math.abs(n))}`;
const dateText = d => new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short'}).format(new Date(`${d}T00:00:00`));
const monthText = m => new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric'}).format(new Date(`${m}-01T00:00:00`));
const monthShort = m => new Intl.DateTimeFormat('th-TH',{month:'short'}).format(new Date(`${m}-01T00:00:00`));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function currentMonth() { return today().slice(0,7); }
function offsetMonth(month, offset) { const [year, m] = month.split('-').map(Number); const d = new Date(Date.UTC(year, m - 1 + offset, 1)); return d.toISOString().slice(0,7); }
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; }
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function request(store, mode='readonly') { return db.transaction(store,mode).objectStore(store); }
function all(store) { return new Promise((resolve,reject)=>{const q=request(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)}); }
function writeRecord(store, action, value) { return new Promise((resolve,reject)=>{ const tx = db.transaction(store, 'readwrite'); tx.objectStore(store)[action](value); tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('การบันทึกถูกยกเลิก')); }); }
function put(store,value) { return writeRecord(store, 'put', value); }
function del(store,id) { return writeRecord(store, 'delete', id); }
async function initDB(){
  db = await new Promise((resolve,reject)=>{const q=indexedDB.open(DB_NAME,DB_VERSION);q.onupgradeneeded=e=>{const d=e.target.result;['transactions','categories','budgets','goals','portfolio','summaries'].forEach(n=>{if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:'id'})})};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
  if(!(await all('categories')).length) await seed(); await hydrate(); bind(); render(); registerOffline();
}
async function seed(){
  await Promise.all(defaultCategories.map(([name,icon,kind])=>put('categories',{id:uid(),name,icon,kind,custom:false})));
  // New users begin with categories only. Never mix demo money into real records.
}
async function hydrate(){ for(const s of Object.keys(cache)) cache[s]=await all(s); }
function monthTx(m=state.month){return cache.transactions.filter(t=>t.date.startsWith(m)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt)}
function totals(m=state.month){const tx=monthTx(m),income=tx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0), expense=tx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0),invest=tx.filter(t=>t.category==='การลงทุน'&&t.type==='expense').reduce((s,t)=>s+t.amount,0);return {income,expense,invest,balance:income-expense,tx};}
function portfolio(){const invested=cache.portfolio.reduce((s,p)=>s+p.shares*p.averagePrice,0),value=cache.portfolio.reduce((s,p)=>s+p.shares*p.currentPrice,0);return {invested,value,gain:value-invested,pct:invested?((value-invested)/invested*100):0};}
function budgets(m=state.month){return cache.budgets.filter(b=>b.month===m).map(b=>({...b,spent:monthTx(m).filter(t=>t.type==='expense'&&t.category===b.category).reduce((s,t)=>s+t.amount,0)}));}
function category(name){const c=cache.categories.find(c=>c.name===name)||{icon:'📦',name};return {...c,icon:esc(c.icon)};}
function daysLeft(){const d=new Date(), end=new Date(d.getFullYear(),d.getMonth()+1,0);return Math.max(1,end.getDate()-d.getDate()+1)}
function usedBudget(){const bs=budgets(), total=bs.reduce((s,b)=>s+b.amount,0),spent=bs.reduce((s,b)=>s+b.spent,0);return {total,spent,left:Math.max(0,total-spent)};}
function render(){
  $('#monthLabel').textContent=monthText(state.month); const meta={dashboard:['สวัสดี 👋','ภาพรวมการเงินของคุณ'],history:['ประวัติรายเดือน','ทุกเดือนเก็บไว้อย่างครบถ้วน'],budget:['งบประมาณ','คุมเงินแบบสบาย ๆ'],goals:['เป้าหมายเงินเก็บ','เห็นทุกก้าวที่เข้าใกล้'],portfolio:['พอร์ตลงทุน','บันทึกราคาได้ด้วยตัวเอง'],analytics:['วิเคราะห์การเงิน','มองภาพการเงินให้ชัดขึ้น']}[state.view]; $('#pageTitle').textContent=meta[0];$('#viewHint').textContent=meta[1];
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  const views={dashboard:dashboardView,history:historyView,budget:budgetView,goals:goalsView,portfolio:portfolioView,analytics:analyticsView}; $('#viewRoot').innerHTML=views[state.view](); bindDynamic();
}
function transactionList(tx,editable=false){if(!tx.length)return `<div class="empty"><span class="empty-icon">☁</span>ยังไม่มีรายการในเดือนนี้<br>กดปุ่ม + เพื่อเริ่มบันทึกได้เลย</div>`;return `<div class="transaction-list">${tx.map(t=>`<article class="transaction" ${editable?`data-transaction="${esc(t.id)}" tabindex="0" aria-label="แก้ไข ${esc(t.category)} ${money(t.amount)} บาท"`:''}><div class="category-icon">${esc(t.icon||category(t.category).icon)}</div><div class="transaction-info"><strong>${esc(t.category)}</strong><span>${esc(t.note||t.account)} · ${dateText(t.date)}</span></div><div class="transaction-amount ${t.type==='expense'?'red':'green'}">${t.type==='expense'?'-':'+'}${money(t.amount)}<small>${editable?'แตะเพื่อแก้ไข':'บาท'}</small></div>${editable?deleteButton('transactions',t.id):''}</article>`).join('')}</div>`}
function deleteButton(store,id){return `<button type="button" class="row-delete" data-remove-store="${store}" data-remove-id="${esc(id)}" aria-label="ลบรายการนี้">ลบ</button>`;}
function dashboardView(){const t=totals(), b=usedBudget(), p=portfolio(),daily=Math.floor(b.left/daysLeft()),warning=b.total&&b.spent/b.total>=.8;return `
  <div class="dashboard-top"><section class="hero-balance"><p class="eyebrow">เงินคงเหลือเดือนนี้</p><p class="balance">฿${money(t.balance)}</p><div class="balance-foot"><div><span>รายรับ</span><strong>+฿${money(t.income)}</strong></div><div><span>รายจ่าย</span><strong>-฿${money(t.expense)}</strong></div></div></section><div class="stat-grid"><article class="stat-card"><div class="stat-icon">◎</div><span class="stat-label">งบที่เหลือ</span><strong class="stat-value">฿${money(b.left)}</strong></article><article class="stat-card"><div class="stat-icon">⌁</div><span class="stat-label">เงินเก็บ</span><strong class="stat-value green">฿${money(Math.max(0,t.balance))}</strong></article><article class="stat-card"><div class="stat-icon">↗</div><span class="stat-label">มูลค่าลงทุน</span><strong class="stat-value">฿${money(p.value)}</strong></article><article class="stat-card"><div class="stat-icon">◷</div><span class="stat-label">ใช้ได้วันนี้</span><strong class="stat-value">฿${money(daily)}</strong></article></div></div>
  <div class="dashboard-mid section"><div class="card spending-card"><div class="spending-orb">◷</div><div><strong>วันนี้ใช้ได้ประมาณ ฿${money(daily)}</strong><p>จากงบที่เหลือ ฿${money(b.left)} ในอีก ${daysLeft()} วัน</p>${warning?'<div class="alert">คุณใช้ใกล้ถึงงบที่ตั้งไว้แล้ว ลองเลือกสิ่งที่สำคัญก่อนนะ</div>':''}</div></div><div class="card"><div class="section-head"><h3>รายรับ / รายจ่าย</h3><span class="eyebrow">6 เดือน</span></div>${miniBars()}</div></div>
  <div class="dashboard-bottom section"><div class="card"><div class="section-head"><h2>รายการล่าสุด</h2><button class="text-btn" data-view="history">ดูทั้งหมด</button></div>${transactionList(t.tx.slice(0,5),true)}</div><div class="card"><div class="section-head"><h2>งบใกล้หมด</h2><button class="text-btn" data-view="budget">จัดการงบ</button></div>${budgetPreview()}</div></div>`}
function miniBars(){const months=periodMonths(6), vals=months.map(m=>totals(m));const max=Math.max(1,...vals.flatMap(x=>[x.income,x.expense]));return `<div class="bar-chart">${vals.map((x,i)=>`<div class="bar-pair"><i class="bar income" style="height:${Math.max(3,x.income/max*100)}%"></i><i class="bar expense" style="height:${Math.max(3,x.expense/max*100)}%"></i><span class="bar-label">${monthShort(months[i])}</span></div>`).join('')}</div><div class="chart-key"><span><i></i>รายรับ</span><span><i class="expense"></i>รายจ่าย</span></div>`}
function budgetPreview(){const list=budgets().sort((a,b)=>(b.spent/b.amount)-(a.spent/a.amount)).slice(0,3);if(!list.length)return `<div class="empty">ยังไม่ได้ตั้งงบประมาณ</div>`;return list.map(b=>{let p=Math.min(100,b.spent/b.amount*100);return `<div class="budget-item"><div class="metric-row"><div><h3>${category(b.category).icon} ${esc(b.category)}</h3><p>ใช้ ฿${money(b.spent)} จาก ฿${money(b.amount)}</p></div><strong class="${p>=100?'red':''}">${money(Math.max(0,b.amount-b.spent))}</strong></div><div class="progress"><i style="width:${p}%"></i></div>${p>=80?'<div class="alert">ใกล้ถึงงบแล้ว</div>':''}</div>`}).join('')}
function historyView(){const months=[...new Set([...cache.transactions.map(t=>t.date.slice(0,7)),...cache.summaries.map(s=>s.month),state.month])].sort().reverse();return `<div class="split-grid"><section><div class="section-head"><h2>ปี ${state.month.slice(0,4)}</h2><button class="text-btn" id="closeMonth">ปิดเดือนนี้</button></div>${months.filter(m=>m.startsWith(state.month.slice(0,4))).map(m=>monthCard(m)).join('')}</section><aside class="card"><h2>เดือนที่เลือก</h2><p class="chart-caption">${monthText(state.month)}</p>${transactionList(monthTx(),true)}</aside></div>`}
function monthCard(m){const t=totals(m),old=cache.summaries.find(s=>s.month===m);return `<article class="month-summary"><h3>${monthText(m)} ${old?'<span class="ticker">ปิดเดือนแล้ว</span>':''}</h3><div class="summary-numbers"><span>รายรับ<strong class="green">+฿${money(t.income)}</strong></span><span>รายจ่าย<strong class="red">-฿${money(t.expense)}</strong></span><span>เหลือ<strong>฿${money(t.balance)}</strong></span></div><button class="summary-action" data-month="${m}">ดูรายละเอียด</button></article>`}
function budgetView(){const list=budgets();const totalsB=usedBudget();return `<div class="split-grid"><section class="card"><div class="section-head"><div><h2>งบของ ${monthShort(state.month)}</h2><p class="chart-caption">วางแผนแล้ว ฿${money(totalsB.total)}</p></div><button class="text-btn" id="addBudget">+ เพิ่มงบ</button></div>${list.length?list.map(b=>budgetRow(b)).join(''):'<div class="empty">เริ่มด้วยการกำหนดงบของคุณ</div>'}</section><aside><section class="hero-balance"><p class="eyebrow">งบที่ยังใช้ได้</p><p class="balance">฿${money(totalsB.left)}</p><div class="balance-foot"><div><span>ใช้ไป</span><strong>฿${money(totalsB.spent)}</strong></div><div><span>ตั้งงบ</span><strong>฿${money(totalsB.total)}</strong></div></div></section><div class="card section"><h3>เคล็ดลับเล็ก ๆ</h3><p class="chart-caption">ไม่จำเป็นต้องสมบูรณ์แบบ แค่รู้ว่าเงินไปไหนก็เป็นจุดเริ่มต้นที่ดีแล้ว</p></div></aside></div>`}
function budgetRow(b){const p=Math.min(100,b.spent/b.amount*100),left=Math.max(0,b.amount-b.spent);return `<div class="budget-item"><div class="metric-row"><div><h3>${category(b.category).icon} ${esc(b.category)}</h3><p>ใช้ไป ฿${money(b.spent)} · เหลือ ฿${money(left)}</p></div><button class="text-btn edit-budget" data-id="${b.id}">แก้ไข</button></div><div class="progress"><i style="width:${p}%"></i></div>${p>=80?`<div class="alert">${p>=100?'เกินงบแล้วเล็กน้อย ลองปรับแผนเดือนหน้าได้':'ใกล้ถึงงบแล้ว ใช้ต่ออย่างสบายใจแต่ระวังนิดหนึ่ง'}</div>`:''}</div>`}
function goalsView(){return `<div class="split-grid"><section class="card"><div class="section-head"><div><h2>เป้าหมายของคุณ</h2><p class="chart-caption">ทุกบาทที่เก็บคือความคืบหน้า</p></div><button class="text-btn" id="addGoal">+ เป้าหมาย</button></div>${cache.goals.length?cache.goals.map(g=>goalRow(g)).join(''):'<div class="empty">สร้างเป้าหมายแรกของคุณได้เลย</div>'}</section><aside class="card"><h2>เงินเก็บรวม</h2><p class="balance green">฿${money(cache.goals.reduce((s,g)=>s+g.saved,0))}</p><p class="chart-caption">กระจายอยู่ใน ${cache.goals.length} เป้าหมาย</p></aside></div>`}
function goalRow(g){const p=Math.min(100,g.saved/g.target*100);return `<article class="goal-card"><div class="metric-row"><div class="goal-title"><span class="category-icon">${esc(g.icon)}</span><div><h3>${esc(g.name)}</h3><p>เก็บแล้ว ฿${money(g.saved)} จาก ฿${money(g.target)}</p></div></div><button class="text-btn edit-goal" data-id="${esc(g.id)}">แก้ไข</button></div><div class="progress"><i style="width:${p}%"></i></div><div class="goal-meta"><span>ความคืบหน้า</span><strong>${Math.round(p)}%</strong></div></article>`}
function portfolioView(){const p=portfolio(), alloc=cache.portfolio.map(x=>p.value?x.shares*x.currentPrice/p.value*100:0);return `<div class="split-grid"><section class="card"><div class="section-head"><div><h2>รายการลงทุน</h2><p class="chart-caption">กรอกราคาปัจจุบันเองได้</p></div><button class="text-btn" id="addHolding">+ เพิ่มหุ้น</button></div>${cache.portfolio.map(h=>holdingRow(h)).join('')}</section><aside><section class="hero-balance"><p class="eyebrow">มูลค่าพอร์ต</p><p class="balance">฿${money(p.value)}</p><div class="balance-foot"><div><span>กำไร / ขาดทุน</span><strong class="${p.gain>=0?'':'red'}">${p.gain>=0?'+':''}฿${money(p.gain)}</strong></div><div><span>ผลตอบแทน</span><strong>${p.pct.toFixed(1)}%</strong></div></div></section><section class="card section"><h3>สัดส่วนการลงทุน</h3><div class="allocation">${alloc.map(a=>`<i style="width:${a}%"></i>`).join('')}</div>${cache.portfolio.map((h,i)=>`<p class="chart-caption">${h.ticker} ${alloc[i].toFixed(0)}%</p>`).join('')}</section></aside></div>`}
function holdingRow(h){let invested=h.shares*h.averagePrice,value=h.shares*h.currentPrice,gain=value-invested;return `<article class="holding"><div class="holding-top"><div><h3>${esc(h.name)} <span class="ticker">${esc(h.ticker)}</span></h3><p>${h.shares} หุ้น · ต้นทุน ฿${money(h.averagePrice)}</p></div><div class="holding-value">฿${money(value)}<small class="${gain>=0?'green':'red'}">${gain>=0?'+':''}${money(gain)} (${invested?(gain/invested*100).toFixed(1):'—'}%)</small></div></div><button class="text-btn edit-holding" data-id="${esc(h.id)}">แก้ไขราคา</button></article>`}
function analyticsView(){const months=periodMonths(state.range),items=months.map(m=>({m,...totals(m)})),cats={};items.flatMap(x=>x.tx).filter(t=>t.type==='expense').forEach(t=>cats[t.category]=(cats[t.category]||0)+t.amount);const catList=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,4),max=Math.max(1,...items.flatMap(x=>[x.income,x.expense,Math.max(0,x.balance)]));return `<div class="section-head"><div class="range-tabs">${[1,3,6,12].map(n=>`<button class="range ${n===state.range?'active':''}" data-range="${n}">${n===1?'เดือนนี้':n+' เดือน'}</button>`).join('')}</div></div><div class="analytics-grid"><section class="card"><h3 class="chart-title">แนวโน้มรายรับ รายจ่าย และเงินเก็บ</h3><p class="chart-caption">${state.range===1?'เดือนที่เลือก':`ย้อนหลัง ${state.range} เดือน`}</p><div class="bar-chart">${items.map((x,i)=>`<div class="bar-pair"><i class="bar income" style="height:${Math.max(3,x.income/max*100)}%"></i><i class="bar expense" style="height:${Math.max(3,x.expense/max*100)}%"></i><i class="bar" style="height:${Math.max(3,Math.max(0,x.balance)/max*100)}%;background:#b9d9bc"></i><span class="bar-label">${monthShort(x.m)}</span></div>`).join('')}</div><div class="chart-key"><span><i></i>รายรับ</span><span><i class="expense"></i>รายจ่าย</span><span><i style="background:#b9d9bc"></i>เงินเก็บ</span></div></section><section class="card"><h3 class="chart-title">ค่าใช้จ่ายตามหมวด</h3><p class="chart-caption">ช่วงเวลาที่เลือก</p>${catList.length?`<div class="donut-row"><div class="donut"><span>฿${money(Object.values(cats).reduce((s,n)=>s+n,0))}</span></div><div class="legend">${catList.map(([n,v],i)=>`<span><i class="${['','b','c','d'][i]}"></i>${category(n).icon} ${esc(n)} ${Math.round(v/Object.values(cats).reduce((s,n)=>s+n,0)*100)}%</span>`).join('')}</div></div>`:'<div class="empty">เพิ่มรายจ่ายเพื่อดูการวิเคราะห์</div>'}</section></div>`}
function periodMonths(n){return Array.from({length:n}, (_,i)=>offsetMonth(state.month,i-n+1));}
function showDialog(id){if(id==='#simpleDialog')$('#deleteSimple').hidden=!simpleEdit;if(id==='#transferDialog')$('#transferSubmit').classList.toggle('destructive-submit',transferPlan?.kind==='delete'||transferPlan?.kind==='cleanup');$(id).showModal()}
function toast(m){const el=$('#toast');el.textContent=m;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function bind(){
  document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){state.view=b.dataset.view;render()}}); $('#quickAdd').onclick=()=>openTx();$('#desktopAdd').onclick=()=>openTx();$('#monthPicker').onclick=()=>{ $('#monthInput').value=state.month;showDialog('#monthDialog')}; $('#monthForm').onsubmit=e=>{e.preventDefault();state.month=$('#monthInput').value;$('#monthDialog').close();render()};
  $('#transactionForm').onsubmit=saveTransaction; $('#deleteTransaction').onclick=()=>state.editTransaction&&stageDeletion('single','transactions',state.editTransaction.id); document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('.type-choice').forEach(b=>b.onclick=()=>{state.type=b.dataset.type;document.querySelectorAll('.type-choice').forEach(x=>x.classList.toggle('selected',x===b));fillCategories()});
  $('#themeToggle').onclick=toggleTheme;$('#themeToggleMobile').onclick=toggleTheme; $('#simpleForm').onsubmit=saveSimple;
  $('#exportData').onclick=()=>exportBackup().catch(reportStorageError); $('#importData').onclick=()=>$('#backupFile').click(); $('#backupFile').onchange=stageImport; $('#reviewDemo').onclick=reviewDemo; $('#transferForm').onsubmit=completeTransfer;
  $('#clearMonthData').onclick=()=>stageDeletion('month');$('#clearAllData').onclick=()=>stageDeletion('all');$('#deleteSimple').onclick=()=>simpleEdit&&stageDeletion('single',{budget:'budgets',goal:'goals',holding:'portfolio'}[simpleKind],simpleEdit.id);
}
function bindDynamic(){
  $('#reviewDemo').hidden=!demoCandidates().length;
  document.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>{state.month=b.dataset.month;render()});document.querySelectorAll('[data-transaction]').forEach(b=>{b.onclick=e=>{if(!e.target.closest('[data-remove-store]'))openTx(cache.transactions.find(x=>x.id===b.dataset.transaction))};b.onkeydown=e=>{if(e.target===b&&(e.key==='Enter'||e.key===' ')){e.preventDefault();b.click()}}});
  $('#closeMonth') && ($('#closeMonth').onclick=closeMonth); $('#addBudget')&&($('#addBudget').onclick=()=>openSimple('budget'));document.querySelectorAll('.edit-budget').forEach(b=>b.onclick=()=>openSimple('budget',cache.budgets.find(x=>x.id===b.dataset.id)));
  $('#addGoal')&&($('#addGoal').onclick=()=>openSimple('goal'));document.querySelectorAll('.edit-goal').forEach(b=>b.onclick=()=>openSimple('goal',cache.goals.find(x=>x.id===b.dataset.id)));
  $('#addHolding')&&($('#addHolding').onclick=()=>openSimple('holding'));document.querySelectorAll('.edit-holding').forEach(b=>b.onclick=()=>openSimple('holding',cache.portfolio.find(x=>x.id===b.dataset.id)));
  document.querySelectorAll('.range').forEach(b=>b.onclick=()=>{state.range=Number(b.dataset.range);render()});
  for(const [selector,store] of [['.edit-budget','budgets'],['.edit-goal','goals'],['.edit-holding','portfolio']])document.querySelectorAll(selector).forEach(b=>b.insertAdjacentHTML('afterend',deleteButton(store,b.dataset.id)));
  document.querySelectorAll('[data-remove-store]').forEach(b=>b.onclick=e=>{e.stopPropagation();stageDeletion('single',b.dataset.removeStore,b.dataset.removeId)});
}
function openTx(edit=null){state.editTransaction=edit;state.type=edit?.type||'expense';$('#transactionForm').reset();$('#transactionDialog h2').textContent=edit?'แก้ไขรายการ':'เพิ่มรายการ';$('#deleteTransaction').hidden=!edit;$('#transactionDate').value=edit?.date||(state.month===currentMonth()?today():`${state.month}-01`);document.querySelectorAll('.type-choice').forEach(x=>x.classList.toggle('selected',x.dataset.type===state.type));fillCategories();if(edit){const f=$('#transactionForm');for(const k of ['amount','category','note','account'])f.elements.namedItem(k).value=edit[k]||''}$('#transactionError').textContent='';showDialog('#transactionDialog')}
function fillCategories(){const order=defaultCategories.map(c=>c[0]);const opts=cache.categories.filter(c=>c.kind===state.type||c.kind==='both').sort((a,b)=>{const x=order.indexOf(a.name),y=order.indexOf(b.name);return (x<0?999:x)-(y<0?999:y)}).map(c=>`<option value="${esc(c.name)}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')+'<option value="__new__">＋ เพิ่มหมวดหมู่ใหม่</option>';$('#categorySelect').innerHTML=opts;$('#categorySelect').onchange=e=>{if(e.target.value==='__new__'){let n=prompt('ชื่อหมวดหมู่ใหม่');if(n?.trim()){let icon=prompt('ไอคอน 1 ตัว (ไม่บังคับ)')||'📦';put('categories',{id:uid(),name:n.trim(),icon,kind:state.type,custom:true}).then(hydrate).then(()=>{fillCategories();$('#categorySelect').value=n.trim()}).catch(reportStorageError)}else fillCategories()}}}
async function saveTransaction(e){
  e.preventDefault(); const form=e.currentTarget, f=new FormData(form), amount=Number(f.get('amount')), date=String(f.get('date')||''), selected=String(f.get('category')||'');
  const error=$('#transactionError'); error.textContent='';
  if(!Number.isFinite(amount)||amount<=0||amount>1e12){error.textContent='กรุณาใส่จำนวนเงินมากกว่า 0 และไม่เกินหนึ่งล้านล้านบาท';return}
  if(!validDate(date)){error.textContent='กรุณาเลือกวันที่ให้ถูกต้อง';return}
  const c=cache.categories.find(c=>c.name===selected&&(c.kind===state.type||c.kind==='both'));
  if(!c){error.textContent='กรุณาเลือกหมวดหมู่ของรายการนี้';return}
  const prior=state.editTransaction, button=form.querySelector('[type="submit"]'); button.disabled=true; button.textContent='กำลังบันทึก…';
  try {
    await put('transactions',{id:prior?.id||uid(),type:state.type,amount:Math.round(amount*100)/100,category:c.name,icon:c.icon,date,note:String(f.get('note')||'').trim(),account:String(f.get('account')||'เงินสด'),createdAt:prior?.createdAt||Date.now()});
    await hydrate(); state.month=date.slice(0,7); $('#transactionDialog').close(); render(); toast(prior?'แก้ไขรายการแล้ว':'บันทึกรายการแล้ว');
  } catch(err) { console.error(err); error.textContent='บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง'; }
  finally { button.disabled=false; button.textContent='บันทึกรายการ'; }
}
async function removeTx(id){if(!confirm('ลบรายการนี้หรือไม่?'))return;await del('transactions',id);await hydrate();$('#transactionDialog').close();render();toast('ลบรายการแล้ว')}
async function closeMonth(){const t=totals(),by={};t.tx.filter(x=>x.type==='expense').forEach(x=>by[x.category]=(by[x.category]||0)+x.amount);const top=Object.entries(by).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—', prev=totals(periodMonths(2)[0]);await put('summaries',{id:state.month,month:state.month,openingBalance:0,closedAt:today(),income:t.income,expense:t.expense,savings:t.balance,invested:t.invest,topCategory:top,vsPrevious:t.expense-prev.expense});await hydrate();toast(`ปิดเดือนแล้ว · ใช้มากสุด: ${top}`);render()}
let simpleKind='',simpleEdit=null;
function openSimple(kind,edit=null){simpleKind=kind;simpleEdit=edit;const names={budget:['งบประมาณ','ตั้งงบรายเดือน'],goal:['เป้าหมายเงินเก็บ','เป้าหมายใหม่'],holding:['พอร์ตลงทุน','เพิ่มการลงทุน']}[kind];$('#simpleEyebrow').textContent=names[0];$('#simpleTitle').textContent=edit?'แก้ไขข้อมูล':names[1];let fields='';if(kind==='budget')fields=`<label>หมวดหมู่<select name="category">${cache.categories.filter(c=>c.kind==='expense').map(c=>`<option ${edit?.category===c.name?'selected':''} value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('')}</select></label><label>งบต่อเดือน (บาท)<input name="amount" type="number" min="1" required value="${edit?.amount||''}" /></label>`;if(kind==='goal')fields=`<label>ชื่อเป้าหมาย<input name="name" maxlength="40" required value="${esc(edit?.name||'')}" /></label><label>ไอคอน<input name="icon" maxlength="4" value="${esc(edit?.icon||'🎯')}" /></label><label>ยอดเป้าหมาย (บาท)<input name="target" type="number" min="1" required value="${edit?.target||''}" /></label><label>เก็บแล้ว (บาท)<input name="saved" type="number" min="0" required value="${edit?.saved||0}" /></label>`;if(kind==='holding')fields=`<label>ชื่อหุ้น / กองทุน<input name="name" maxlength="50" required value="${esc(edit?.name||'')}" /></label><label>Ticker<input name="ticker" maxlength="12" required value="${esc(edit?.ticker||'')}" /></label><label>จำนวนที่ถือ<input name="shares" type="number" step="0.0001" min="0.0001" required value="${edit?.shares||''}" /></label><label>ราคาซื้อเฉลี่ย (บาท)<input name="averagePrice" type="number" min="0" required value="${edit?.averagePrice||''}" /></label><label>ราคาปัจจุบัน (บาท)<input name="currentPrice" type="number" min="0" required value="${edit?.currentPrice||''}" /></label>`;$('#simpleFields').innerHTML=fields;$('#simpleError').textContent='';showDialog('#simpleDialog')}
async function saveSimple(e){
  e.preventDefault();const form=e.currentTarget,f=Object.fromEntries(new FormData(form));const store={budget:'budgets',goal:'goals',holding:'portfolio'}[simpleKind],record={...f};const positive=v=>Number.isFinite(v)&&v>0&&v<=1e12,nonnegative=v=>Number.isFinite(v)&&v>=0&&v<=1e12;
  $('#simpleError').textContent='';
  if(simpleKind==='budget'){record.amount=Number(record.amount);record.month=state.month;record.id=simpleEdit?.id||cache.budgets.find(b=>b.month===state.month&&b.category===record.category)?.id||uid();if(!positive(record.amount)){$('#simpleError').textContent='กรุณาใส่งบมากกว่า 0 บาท';return}if(cache.budgets.some(b=>b.month===state.month&&b.category===record.category&&b.id!==record.id)){$('#simpleError').textContent='มีงบหมวดนี้แล้ว กรุณาแก้ไขงบเดิม';return}}
  if(simpleKind==='goal'){record.name=record.name.trim();record.icon=record.icon.trim()||'🎯';record.target=Number(record.target);record.saved=Number(record.saved);record.id=simpleEdit?.id||uid();if(!record.name||!positive(record.target)||!nonnegative(record.saved)){$('#simpleError').textContent='กรุณาใส่ชื่อ เป้าหมายมากกว่า 0 และยอดเก็บไม่ติดลบ';return}}
  if(simpleKind==='holding'){for(const k of ['shares','averagePrice','currentPrice'])record[k]=Number(record[k]);record.name=record.name.trim();record.ticker=record.ticker.trim().toUpperCase();record.id=simpleEdit?.id||uid();if(!record.name||!record.ticker||/[<>"']/.test(record.ticker)||!positive(record.shares)||!nonnegative(record.averagePrice)||!nonnegative(record.currentPrice)){$('#simpleError').textContent='กรุณากรอกชื่อ Ticker จำนวนหุ้นมากกว่า 0 และราคาไม่ติดลบ';return}}
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{await put(store,record);await hydrate();$('#simpleDialog').close();render();toast('บันทึกข้อมูลแล้ว')}catch(err){console.error(err);$('#simpleError').textContent='บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง'}finally{button.disabled=false}
}
function toggleTheme(){let dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'';localStorage.setItem('moneyos-theme',dark?'dark':'light')}
const storeLabels={transactions:'รายการรับ–จ่าย',categories:'หมวดหมู่',budgets:'งบประมาณ',goals:'เป้าหมาย',portfolio:'รายการลงทุน',summaries:'สรุปรายเดือน'};
let transferPlan=null;
function reportStorageError(err){console.error(err);toast('ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง');}
function atomicRecords(changes){return new Promise((resolve,reject)=>{const stores=[...new Set(changes.map(x=>x.store))];if(!stores.length){resolve();return}const tx=db.transaction(stores,'readwrite');for(const c of changes){const s=tx.objectStore(c.store);c.action==='delete'?s.delete(c.id):s.put(c.record)}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('ยกเลิกการบันทึก'));});}
async function exportBackup(){
  await hydrate(); const payload={format:'MoneyOS',version:1,exportedAt:new Date().toISOString(),data:cache};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`MoneyOS-backup-${today()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว');return payload;
}
function validateBackup(payload){
  if(!payload||payload.format!=='MoneyOS'||payload.version!==1||!payload.data)throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรอง MoneyOS รุ่นที่รองรับ');
  const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  const positive=v=>Number.isFinite(v)&&v>0&&v<=1e12;const nonnegative=v=>Number.isFinite(v)&&v>=0&&v<=1e12;
  const month=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  for(const store of Object.keys(cache)){
    const records=payload.data[store];if(!Array.isArray(records)||records.length>20000)throw new Error(`ข้อมูล${storeLabels[store]}ไม่ถูกต้อง`);
    const ids=new Set();
    for(const r of records){
      let ok=r&&typeof r==='object'&&text(r.id)&&!/[<>"']/.test(r.id)&&!ids.has(r.id);ids.add(r?.id);
      if(store==='transactions')ok=ok&&['income','expense'].includes(r.type)&&positive(r.amount)&&validDate(r.date)&&text(r.category)&&text(r.account)&&typeof r.note==='string'&&r.note.length<=500;
      if(store==='categories')ok=ok&&text(r.name)&&text(r.icon,20)&&['income','expense','both'].includes(r.kind);
      if(store==='budgets')ok=ok&&month(r.month)&&text(r.category)&&positive(r.amount);
      if(store==='goals')ok=ok&&text(r.name)&&positive(r.target)&&nonnegative(r.saved)&&text(r.icon,20);
      if(store==='portfolio')ok=ok&&text(r.name)&&text(r.ticker,20)&&!/[<>"']/.test(r.ticker)&&positive(r.shares)&&nonnegative(r.averagePrice)&&nonnegative(r.currentPrice);
      if(store==='summaries')ok=ok&&month(r.month)&&(r.income===undefined||nonnegative(r.income))&&(r.expense===undefined||nonnegative(r.expense))&&(r.savings===undefined||Number.isFinite(r.savings));
      if(!ok)throw new Error(`พบข้อมูล${storeLabels[store]}ผิดรูปแบบ ยังไม่ได้นำเข้าหรือแก้ข้อมูลเดิม`);
    }
  }
  return payload.data;
}
async function stageImport(e){
  const file=e.target.files[0];if(!file)return;e.target.value='';
  $('#transferTitle').textContent='นำเข้าข้อมูล';$('#transferBody').innerHTML='';$('#transferError').textContent='';$('#transferSubmit').textContent='นำเข้ารายการใหม่';$('#transferSubmit').disabled=true;showDialog('#transferDialog');
  try{
    if(file.size>10*1024*1024)throw new Error('ไฟล์ใหญ่เกิน 10 MB กรุณาใช้ไฟล์สำรอง MoneyOS');
    const data=validateBackup(JSON.parse(await file.text()));await hydrate();let skipped=0;const changes=[];
    for(const store of Object.keys(cache)){for(const record of data[store]){const exists=cache[store].some(r=>r.id===record.id||(store==='categories'&&r.name===record.name&&r.kind===record.kind));if(exists)skipped++;else changes.push({store,record,action:'put'})}}
    transferPlan={kind:'import',changes};$('#transferBody').innerHTML=`<p class="transfer-note">รวมข้อมูลจากไฟล์เข้ากับเครื่องนี้ รายการที่มีรหัสเดิมจะข้ามไป จึงไม่เขียนทับข้อมูลที่มีอยู่</p><div class="transfer-summary">${Object.keys(cache).map(s=>`<span>${storeLabels[s]}: ${changes.filter(c=>c.store===s).length}</span>`).join('')}</div><p class="transfer-note">ข้ามรายการเดิม ${skipped} รายการ</p>`;$('#transferSubmit').disabled=false;
  }catch(err){transferPlan=null;$('#transferError').textContent=err instanceof SyntaxError?'อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ JSON ที่สำรองจาก MoneyOS':err.message;}
}
function demoCandidates(){
  const originalTransactions=[['income',18000,'เงินเดือน',1,'เงินเดือนประจำ'],['expense',80,'อาหาร',16,'ก๋วยเตี๋ยว'],['expense',40,'เดินทาง',15,'รถไฟฟ้า'],['expense',150,'ความบันเทิง',13,'เกมใหม่'],['expense',2800,'อาหาร',9,'ซื้อของเข้าบ้าน'],['expense',780,'บิล/ค่าใช้จ่ายประจำ',5,'อินเทอร์เน็ต'],['expense',1500,'การลงทุน',3,'DCA']];
  const candidates=[];
  for(const t of cache.transactions)if(t.account==='บัญชีหลัก'&&originalTransactions.some(([type,amount,cat,day,note])=>t.type===type&&t.amount===amount&&t.category===cat&&Number(t.date.slice(-2))===day&&t.note===note))candidates.push({store:'transactions',record:t,label:`${t.category} ${fullMoney(t.amount)} · ${t.note}`,detail:dateText(t.date)});
  for(const g of cache.goals)if((g.name==='ซื้อโทรศัพท์'&&g.target===30000&&g.saved===12000)||(g.name==='เงินฉุกเฉิน'&&g.target===50000&&g.saved===20000))candidates.push({store:'goals',record:g,label:`เป้าหมาย: ${g.name}`,detail:`เก็บแล้ว ${fullMoney(g.saved)}`});
  for(const p of cache.portfolio)if([['AAPL',4,6700,7500],['MSFT',3,12400,13000],['VOO',2,17500,18100]].some(([t,s,a,c])=>p.ticker===t&&p.shares===s&&p.averagePrice===a&&p.currentPrice===c))candidates.push({store:'portfolio',record:p,label:`พอร์ต: ${p.ticker}`,detail:`${p.shares} หุ้น`});
  for(const b of cache.budgets)if([['อาหาร',4000],['เดินทาง',2000],['ความบันเทิง',1000],['ของใช้',1500],['อื่น ๆ',1000]].some(([c,a])=>b.category===c&&b.amount===a))candidates.push({store:'budgets',record:b,label:`งบ ${b.category}: ${fullMoney(b.amount)}`,detail:monthText(b.month)});
  for(const s of cache.summaries)if([1,2,3,4,5].some(i=>s.income===15000+i*400&&s.expense===9500+i*220&&s.savings===5500+i*180&&s.openingBalance===6000+i*350))candidates.push({store:'summaries',record:s,label:`สรุปตัวอย่าง ${monthText(s.month)}`,detail:`รายรับ ${fullMoney(s.income)}`});
  return candidates;
}
function reviewDemo(){
  const candidates=demoCandidates();transferPlan={kind:'cleanup',candidates};$('#transferTitle').textContent='ตรวจรายการตัวอย่าง';$('#transferError').textContent='';$('#transferSubmit').disabled=false;$('#transferSubmit').textContent='สำรองข้อมูล แล้วลบที่เลือก';
  $('#transferBody').innerHTML=`<p class="transfer-note">รายการต่อไปนี้ตรงกับข้อมูลตัวอย่างของรุ่นเก่า เลือกเฉพาะรายการที่ไม่ใช่ข้อมูลจริงของคุณ ระบบจะดาวน์โหลดไฟล์สำรองก่อนลบ</p>${candidates.map((c,i)=>`<label class="demo-choice"><input type="checkbox" name="demo" value="${i}"/><span>${esc(c.label)}<small>${esc(c.detail)}</small></span></label>`).join('')}`;showDialog('#transferDialog');
}
function stageDeletion(kind,store,id){
  let changes=[],title='',detail='';
  if(kind==='single'){
    const r=cache[store]?.find(r=>r.id===id);if(!r)return;changes=[{store,id,action:'delete'}];title='ลบรายการนี้?';detail=store==='transactions'?`${r.category} ${fullMoney(r.amount)} · ${dateText(r.date)} · ${r.note||r.account}`:r.name||r.category||r.ticker;
  }else if(kind==='month'){
    title=`ล้างข้อมูล ${monthText(state.month)}`;detail='ลบรายการรับ–จ่าย งบประมาณ และสรุปของเดือนที่เลือก เป้าหมายเงินเก็บ พอร์ต และข้อมูลเดือนอื่นยังอยู่';
    for(const s of ['transactions','budgets','summaries'])for(const r of cache[s])if((s==='transactions'?r.date.slice(0,7):r.month)===state.month)changes.push({store:s,id:r.id,action:'delete'});
  }else{
    title='ล้างข้อมูลทั้งหมด';detail='ลบรายการรับ–จ่ายทุกเดือน งบ เป้าหมาย พอร์ต สรุปรายเดือน และหมวดที่เพิ่มเอง แล้วเริ่มจากข้อมูลว่าง';
    for(const s of Object.keys(cache))for(const r of cache[s])changes.push({store:s,id:r.id,action:'delete'});
    defaultCategories.forEach(([name,icon,kind],i)=>changes.push({store:'categories',record:{id:`default-${i}`,name,icon,kind,custom:false},action:'put'}));
  }
  if($('#transactionDialog').open)$('#transactionDialog').close();if($('#simpleDialog').open)$('#simpleDialog').close();
  transferPlan={kind:'delete',scope:kind,changes};$('#transferTitle').textContent=title;$('#transferError').textContent='';$('#transferSubmit').disabled=false;$('#transferSubmit').textContent=kind==='single'?'ยืนยันลบรายการ':'ยืนยันล้างข้อมูล';
  $('#transferBody').innerHTML=`<p class="transfer-note">${esc(detail)}</p><div class="transfer-summary">${Object.keys(cache).filter(s=>changes.some(c=>c.store===s&&c.action==='delete')).map(s=>`<span>${storeLabels[s]}: ${changes.filter(c=>c.store===s&&c.action==='delete').length}</span>`).join('')}</div>${kind==='single'?'':`<label class="transfer-check"><input name="backupFirst" type="checkbox" checked />สำรองข้อมูลก่อนลบ</label><label>พิมพ์ “ลบ” เพื่อยืนยัน<input name="confirmDelete" autocomplete="off" required /></label>`}`;showDialog('#transferDialog');
}
async function completeTransfer(e){
  e.preventDefault();if(!transferPlan)return;const button=$('#transferSubmit');button.disabled=true;$('#transferError').textContent='';
  try{
    if(transferPlan.kind==='import'){await atomicRecords(transferPlan.changes);toast('นำเข้าข้อมูลแล้ว');}
    else if(transferPlan.kind==='delete'){const f=new FormData(e.currentTarget);if(transferPlan.scope!=='single'&&String(f.get('confirmDelete')||'').trim()!=='ลบ')throw new Error('กรุณาพิมพ์ ลบ เพื่อยืนยันการล้างข้อมูล');if(f.has('backupFirst'))await exportBackup();await atomicRecords(transferPlan.changes);toast(transferPlan.scope==='single'?'ลบรายการแล้ว':'ล้างข้อมูลที่เลือกแล้ว');}
    else{const selected=[...new FormData(e.currentTarget).getAll('demo')].map(i=>transferPlan.candidates[Number(i)]).filter(Boolean);if(!selected.length)throw new Error('กรุณาเลือกรายการตัวอย่างที่ต้องการลบ');await exportBackup();await atomicRecords(selected.map(c=>({store:c.store,id:c.record.id,action:'delete'})));toast(`ลบรายการตัวอย่างที่เลือก ${selected.length} รายการแล้ว`);}
    await hydrate();$('#transferDialog').close();transferPlan=null;render();
  }catch(err){console.error(err);$('#transferError').textContent=err.message||'ดำเนินการไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาลองอีกครั้ง';}
  finally{button.disabled=false;}
}
function registerOffline(){
  if(!('serviceWorker' in navigator)||!['http:','https:'].includes(location.protocol)||location.hostname.endsWith('.chatgpt.site'))return;
  navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Offline cache unavailable',err));
}
if(localStorage.getItem('moneyos-theme')==='dark')document.documentElement.dataset.theme='dark';
initDB().catch(err=>{console.error(err);$('#viewRoot').innerHTML='<div class="card empty">ไม่สามารถเปิดฐานข้อมูลในเครื่องได้ กรุณาลองเปิดใหม่อีกครั้ง</div>'});
