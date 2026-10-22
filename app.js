const DB_NAME = "wordvision-personal-db";
const DB_VERSION = 1;
let db;
let words = [];
let learned = new Set();
let todayCount = 0;
let learnIndex = 0;
let associateIndex = 0;
let quizTarget = null;
let quizAnswered = false;
let quizCorrect = 0;
let quizTotal = 0;
let pendingImage = null;
let toastTimer;

const $ = (id) => document.getElementById(id);
const todayKey = new Date().toLocaleDateString("en-CA");

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("words")) database.createObjectStore("words", { keyPath: "id" });
      if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function store(name, mode = "readonly") { return db.transaction(name, mode).objectStore(name); }
function getAllWords() { return new Promise((resolve, reject) => { const r = store("words").getAll(); r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error); }); }
function getMeta(key) { return new Promise((resolve) => { const r=store("meta").get(key); r.onsuccess=()=>resolve(r.result?.value); r.onerror=()=>resolve(undefined); }); }
function setMeta(key, value) { return new Promise((resolve,reject)=>{const r=store("meta","readwrite").put({key,value});r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}); }
function saveWord(word) { return new Promise((resolve,reject)=>{const r=store("words","readwrite").put(word);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}); }
function deleteWord(id) { return new Promise((resolve,reject)=>{const r=store("words","readwrite").delete(id);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}); }
function clearStore(name) { return new Promise((resolve,reject)=>{const r=store(name,"readwrite").clear();r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function escapeHTML(value="") { return String(value).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function showToast(message) { const el=$("toast"); el.textContent=message; el.classList.remove("hidden"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.add("hidden"),2800); }
function shuffle(list) { const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function imageMarkup(word, cls="word-image") {
  if (word.image) return `<img class="${cls}" src="${word.image}" alt="${escapeHTML(word.word)} 的联想图片">`;
  return `<div class="${cls} no-image">🖼️<span style="font-size:14px;margin-left:8px">尚未上传图片</span></div>`;
}
function getById(id) { return words.find(w=>w.id===id); }
function setView(name) {
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $(`${name}View`).classList.remove("hidden");
  if(name==="learn") renderLearn();
  if(name==="associate") renderAssociation();
  if(name==="manage") renderWordList();
}
function renderStats() {
  $("wordCount").textContent=words.length;
  $("learnedCount").textContent=learned.size;
  $("todayCount").textContent=todayCount;
}
async function markLearned(word) {
  if(!word) return;
  learned.add(word.id);
  todayCount++;
  await setMeta("learnedIds",[...learned]);
  await setMeta("todayStats",{date:todayKey,count:todayCount});
  renderStats();
}
function renderLearn() {
  const card=$("learnCard");
  if(!words.length) { card.className="study-card empty-state";card.innerHTML='<div class="empty-icon">🖼️</div><h3>你的词库还没有单词</h3><p>你可以先添加单词，或导入自己的 CSV / TXT 词表。</p><button class="btn btn-primary" data-goto="manage">去添加单词</button>'; $("learnControls").classList.add("hidden");$("meaningPanel").classList.add("hidden");$("learnPosition").textContent="0 / 0";return; }
  learnIndex=((learnIndex%words.length)+words.length)%words.length;
  const w=words[learnIndex];
  $("learnPosition").textContent=`${learnIndex+1} / ${words.length}`;
  card.className="study-card";
  card.innerHTML=`${imageMarkup(w)}<div class="study-word">${escapeHTML(w.word)}</div>${w.pos?`<div class="study-pos">${escapeHTML(w.pos)}</div>`:""}<p class="study-example">${w.example?escapeHTML(w.example):"观察图片，想一想这个单词表达的核心概念。"}</p>`;
  $("learnControls").classList.remove("hidden");
  $("meaningPanel").classList.add("hidden");
}
async function revealMeaning() {
  const w=words[learnIndex]; if(!w)return;
  $("meaningPanel").innerHTML=`<strong>中文释义：</strong>${escapeHTML(w.meaning)}${w.example?`<p>${escapeHTML(w.example)}</p>`:""}`;
  $("meaningPanel").classList.remove("hidden");
  await markLearned(w);
}
function renderAssociation() {
  const card=$("associateCard");
  if(!words.length){card.className="study-card empty-state";card.innerHTML='<div class="empty-icon">💭</div><h3>等待你的词库</h3><p>添加单词和图片后，就可以开始联想练习。</p><button class="btn btn-primary" data-goto="manage">去添加单词</button>';$("associateControls").classList.add("hidden");$("associationAnswer").classList.add("hidden");$("associatePosition").textContent="0 / 0";return;}
  associateIndex=((associateIndex%words.length)+words.length)%words.length;
  const w=words[associateIndex];$("associatePosition").textContent=`${associateIndex+1} / ${words.length}`;
  card.className="study-card";card.innerHTML=`${imageMarkup(w)}<p class="muted">先不要看答案，尝试回忆英文词和中文含义。</p><div class="study-word">？</div><p class="study-example">你会用哪个英文单词描述这张图片？</p>`;
  $("associateControls").classList.remove("hidden");$("associationAnswer").classList.add("hidden");
}
async function showAssociation() {
  const w=words[associateIndex];if(!w)return;
  $("associationAnswer").innerHTML=`<div class="study-word">${escapeHTML(w.word)}</div><strong>${escapeHTML(w.meaning)}</strong>${w.pos?`<p class="muted">${escapeHTML(w.pos)}</p>`:""}${w.example?`<p>${escapeHTML(w.example)}</p>`:""}`;
  $("associationAnswer").classList.remove("hidden");await markLearned(w);
}
function startQuiz() {
  if(words.length<2){showToast("至少添加 2 个单词后才能开始看图猜词。");return;}
  quizCorrect=0;quizTotal=0;quizAnswered=false;
  $("quizScore").textContent="答对 0 题";$("quizFeedback").classList.add("hidden");$("startQuiz").classList.add("hidden");nextQuiz();
}
function nextQuiz() {
  if(words.length<2){$("quizCard").innerHTML='<h3>至少需要 2 个单词</h3>';return;}
  quizTarget=shuffle(words)[0];quizAnswered=false;
  const distractors=shuffle(words.filter(w=>w.id!==quizTarget.id)).slice(0,3);
  const options=shuffle([quizTarget,...distractors]);
  $("quizCard").className="study-card";
  $("quizCard").innerHTML=`${imageMarkup(quizTarget)}<p class="muted">请选择最符合图片含义的英文单词</p><div class="quiz-options">${options.map(w=>`<button class="quiz-option" data-answer="${escapeHTML(w.id)}">${escapeHTML(w.word)}</button>`).join("")}</div>`;
  document.querySelectorAll(".quiz-option").forEach(b=>b.addEventListener("click",()=>answerQuiz(b)));
  $("quizFeedback").classList.add("hidden");$("nextQuiz").classList.add("hidden");
}
async function answerQuiz(button) {
  if(quizAnswered)return;quizAnswered=true;quizTotal++;
  const correct=button.dataset.answer===quizTarget.id;
  if(correct){quizCorrect++;button.classList.add("correct");}
  else {button.classList.add("incorrect");document.querySelectorAll(".quiz-option").forEach(b=>{if(b.dataset.answer===quizTarget.id)b.classList.add("correct");});}
  document.querySelectorAll(".quiz-option").forEach(b=>b.disabled=true);
  $("quizScore").textContent=`答对 ${quizCorrect} / ${quizTotal} 题`;
  $("quizFeedback").className=`feedback ${correct?"good":"bad"}`;
  $("quizFeedback").textContent=correct?`回答正确！${quizTarget.word}：${quizTarget.meaning}`:`正确答案是 ${quizTarget.word}：${quizTarget.meaning}`;
  $("quizFeedback").classList.remove("hidden");$("nextQuiz").classList.remove("hidden");
  await markLearned(quizTarget);
}
function renderWordList(filter="") {
  const list=$("wordList");const q=filter.trim().toLowerCase();
  const shown=words.filter(w=>`${w.word} ${w.meaning} ${w.pos||""} ${w.example||""}`.toLowerCase().includes(q));
  $("listCount").textContent=`（${shown.length}）`;
  if(!shown.length){list.innerHTML='<p class="muted">没有找到单词。你可以添加新单词或调整搜索词。</p>';return;}
  list.innerHTML=shown.map(w=>`<article class="word-row"><div class="word-thumb">${w.image?`<img src="${w.image}" alt="">`:"🖼️"}</div><div class="word-row-main"><strong>${escapeHTML(w.word)}</strong><small>${escapeHTML(w.meaning)}</small>${w.pos?`<small>${escapeHTML(w.pos)}</small>`:""}</div><div class="row-actions"><button data-edit="${escapeHTML(w.id)}">编辑</button><button class="delete" data-delete="${escapeHTML(w.id)}">删除</button></div></article>`).join("");
}
function resetForm() {
  $("wordForm").reset();$("wordId").value="";pendingImage=null;$("imagePreview").innerHTML="";$("imagePreview").classList.add("hidden");$("formTitle").textContent="添加一个单词";$("cancelEdit").classList.add("hidden");
}
function editWord(id) {
  const w=getById(id);if(!w)return;
  $("wordId").value=w.id;$("wordInput").value=w.word;$("meaningInput").value=w.meaning;$("posInput").value=w.pos||"";$("exampleInput").value=w.example||"";pendingImage=w.image||null;
  $("formTitle").textContent=`编辑：${w.word}`;$("cancelEdit").classList.remove("hidden");
  if(pendingImage){$("imagePreview").innerHTML=`<img src="${pendingImage}" alt="当前图片"><button type="button" id="removeImage" class="btn btn-secondary">移除图片</button>`;$("imagePreview").classList.remove("hidden");$("removeImage").addEventListener("click",()=>{pendingImage=null;$("imagePreview").classList.add("hidden");$("imagePreview").innerHTML="";});}
  else{$("imagePreview").classList.add("hidden");}
  $("wordInput").focus();window.scrollTo({top:$("wordForm").getBoundingClientRect().top+window.scrollY-20,behavior:"smooth"});
}
async function fileToDataURL(file) {
  if(!file.type.startsWith("image/"))throw new Error("请选择图片文件。");
  if(file.size>8*1024*1024)throw new Error("图片文件建议小于 8 MB。");
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("读取图片失败。"));r.readAsDataURL(file);});
}
async function compressImage(file) {
  const data=await fileToDataURL(file);
  return new Promise(resolve=>{
    const img=new Image();img.onload=()=>{const max=1200;const scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL("image/jpeg",0.82));};img.onerror=()=>resolve(data);img.src=data;
  });
}
function parseCSV(text) {
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],next=text[i+1];if(c==='"'){if(quoted&&next==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===","&&!quoted){row.push(field);field="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&next==="\n")i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field="";}else field+=c;}
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
async function importWordFile(file) {
  const text=await file.text();const isCSV=file.name.toLowerCase().endsWith(".csv");
  let records=[];
  if(isCSV){
    const rows=parseCSV(text);if(!rows.length){showToast("文件内容为空。");return;}
    const first=rows[0].map(x=>x.trim().toLowerCase());
    const hasHeader=first.some(x=>["word","单词","english","英文"].includes(x));
    const start=hasHeader?1:0;
    const indexes=hasHeader?{word:findCol(first,["word","单词","english","英文"],0),meaning:findCol(first,["meaning","中文","释义","translation"],1),pos:findCol(first,["pos","词性"],2),example:findCol(first,["example","例句","提示"],3)}:{word:0,meaning:1,pos:2,example:3};
    records=rows.slice(start).map(r=>({word:(r[indexes.word]||"").trim(),meaning:(r[indexes.meaning]||"").trim(),pos:(r[indexes.pos]||"").trim(),example:(r[indexes.example]||"").trim()}));
  } else {
    records=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.includes("\t")?line.split("\t"):line.split(/[|，]/);return {word:(parts[0]||"").trim(),meaning:(parts[1]||"").trim(),pos:(parts[2]||"").trim(),example:(parts[3]||"").trim()};});
  }
  let added=0,updated=0;
  for(const r of records){if(!r.word||!r.meaning)continue;const existing=words.find(w=>w.word.toLowerCase()===r.word.toLowerCase());const item={id:existing?.id||uid(),word:r.word,meaning:r.meaning,pos:r.pos||existing?.pos||"",example:r.example||existing?.example||"",image:existing?.image||"",createdAt:existing?.createdAt||Date.now()};await saveWord(item);if(existing)updated++;else added++;}
  await refreshWords();showToast(`导入完成：新增 ${added} 个，更新 ${updated} 个。`);
}
function findCol(headers, names, fallback) {const idx=headers.findIndex(h=>names.includes(h));return idx>=0?idx:fallback;}
function downloadBlob(blob, filename) {const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function csvEscape(v="") {const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function exportCSV() {
  const lines=[["word","meaning","pos","example"].map(csvEscape).join(",")];
  words.forEach(w=>lines.push([w.word,w.meaning,w.pos||"",w.example||""].map(csvEscape).join(",")));
  downloadBlob(new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),"wordvision-vocabulary.csv");
}
async function exportBackup() {
  const meta={learnedIds:[...learned],todayStats:{date:todayKey,count:todayCount}};
  downloadBlob(new Blob([JSON.stringify({app:"WordVision",version:1,exportedAt:new Date().toISOString(),words,meta},null,2)],{type:"application/json"}),"wordvision-backup.json");
}
async function restoreBackup(file) {
  try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.words))throw new Error("这不是有效的 WordVision 备份文件。");if(!confirm(`备份中有 ${data.words.length} 个单词。恢复会覆盖当前词库，是否继续？`))return;
    await clearStore("words");for(const w of data.words){if(w.word&&w.meaning)await saveWord({...w,id:w.id||uid()});}
    if(data.meta?.learnedIds)await setMeta("learnedIds",data.meta.learnedIds);
    if(data.meta?.todayStats)await setMeta("todayStats",data.meta.todayStats);
    await loadState();showToast("备份恢复成功。");
  }catch(e){showToast(e.message||"恢复失败，请检查文件。");}
}
async function refreshWords() {words=await getAllWords();words.sort((a,b)=>(a.word||"").localeCompare(b.word||""));renderStats();renderLearn();renderAssociation();renderWordList($("searchWords").value||"");}
async function loadState() {
  words=await getAllWords();words.sort((a,b)=>(a.word||"").localeCompare(b.word||""));
  learned=new Set((await getMeta("learnedIds"))||[]);
  const stat=await getMeta("todayStats");todayCount=stat?.date===todayKey?stat.count:0;
  renderStats();renderLearn();renderAssociation();renderWordList();
}
function downloadTemplate() {
  const content="\uFEFFword,meaning,pos,example\r\nbridge,桥；桥梁,noun,A bridge connects two sides of a river.\r\nroot,根；根源,noun,The roots absorb water from the soil.\r\nharvest,收获；收割,noun/verb,Farmers harvest crops in autumn.\r\n";
  downloadBlob(new Blob([content],{type:"text/csv;charset=utf-8"}),"wordvision-template.csv");
}
function bindEvents() {
  document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
  document.addEventListener("click",e=>{const goto=e.target.closest("[data-goto]");if(goto)setView(goto.dataset.goto);});
  $("prevWord").addEventListener("click",()=>{learnIndex=(learnIndex-1+words.length)%words.length;renderLearn();});
  $("nextWord").addEventListener("click",()=>{learnIndex=(learnIndex+1)%words.length;renderLearn();});
  $("revealMeaning").addEventListener("click",revealMeaning);
  $("startQuiz").addEventListener("click",startQuiz);$("nextQuiz").addEventListener("click",nextQuiz);
  $("showAssociation").addEventListener("click",showAssociation);
  $("nextAssociation").addEventListener("click",()=>{associateIndex=(associateIndex+1)%words.length;renderAssociation();});
  $("wordForm").addEventListener("submit",async e=>{
    e.preventDefault();const word=$("wordInput").value.trim(),meaning=$("meaningInput").value.trim();if(!word||!meaning){showToast("英文单词和中文释义为必填项。");return;}
    const id=$("wordId").value||uid();const existing=getById(id);const item={id,word,meaning,pos:$("posInput").value.trim(),example:$("exampleInput").value.trim(),image:pendingImage||existing?.image||"",createdAt:existing?.createdAt||Date.now()};
    await saveWord(item);await refreshWords();resetForm();showToast("单词已保存。");
  });
  $("imageInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{pendingImage=await compressImage(file);$("imagePreview").innerHTML=`<img src="${pendingImage}" alt="图片预览"><button type="button" id="removeImage" class="btn btn-secondary">移除图片</button>`;$("imagePreview").classList.remove("hidden");$("removeImage").addEventListener("click",()=>{pendingImage=null;$("imagePreview").classList.add("hidden");$("imagePreview").innerHTML="";$("imageInput").value="";});}catch(err){showToast(err.message||"图片处理失败。");}});
  $("cancelEdit").addEventListener("click",resetForm);
  $("wordList").addEventListener("click",async e=>{const edit=e.target.closest("[data-edit]");const del=e.target.closest("[data-delete]");if(edit)editWord(edit.dataset.edit);if(del){const w=getById(del.dataset.delete);if(w&&confirm(`确定删除单词“${w.word}”吗？`)){await deleteWord(w.id);learned.delete(w.id);await setMeta("learnedIds",[...learned]);await refreshWords();showToast("已删除。");}}});
  $("searchWords").addEventListener("input",e=>renderWordList(e.target.value));
  $("importFile").addEventListener("change",async e=>{const file=e.target.files?.[0];if(file){try{await importWordFile(file);}catch(err){showToast(err.message||"导入失败，请检查文件格式。");}e.target.value="";}});
  $("downloadTemplate").addEventListener("click",downloadTemplate);$("exportWords").addEventListener("click",exportCSV);$("exportBackup").addEventListener("click",exportBackup);
  $("restoreBackup").addEventListener("change",async e=>{const f=e.target.files?.[0];if(f)await restoreBackup(f);e.target.value="";});
  $("clearAll").addEventListener("click",async()=>{if(confirm("确定清空所有单词、图片和学习记录吗？此操作无法撤销。建议先导出完整备份。")){await clearStore("words");await clearStore("meta");words=[];learned=new Set();todayCount=0;learnIndex=0;associateIndex=0;resetForm();await loadState();showToast("本地词库已清空。");}});
}
async function init() {
  try{db=await openDB();await loadState();bindEvents();
    if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
  }catch(e){console.error(e);showToast("浏览器存储初始化失败。建议使用最新版 Safari、Chrome 或 Edge。");}
  let deferredPrompt=null;
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden");});
  $("installBtn").addEventListener("click",async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden");}else{showToast("iPhone 请在 Safari 中点分享按钮，再选择“添加到主屏幕”。");}});
}
init();
// ===== 单词发音功能 =====
(function () {
  const synth = window.speechSynthesis;
  if (!synth) return; // 浏览器不支持就跳过

  let voice = null;
  function pickVoice() {
    const voices = synth.getVoices();
    voice =
      voices.find(v => v.lang === "en-US" && /Google|Samantha|Microsoft/i.test(v.name)) ||
      voices.find(v => v.lang.startsWith("en")) ||
      null;
  }
  pickVoice();
  synth.onvoiceschanged = pickVoice;

  window.speakWord = function (text) {
    if (!text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.85;
    if (voice) u.voice = voice;
    synth.speak(u);
  };

  // 在"图片学习"和"联想练习"的卡片里，单词出现时自动朗读
  const watch = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
      const w = el.querySelector(".study-word");
      if (!w) return;
      const word = w.textContent.trim();
      if (el.dataset.spoken === word) return;
      el.dataset.spoken = word;
      window.speakWord(word);
    }).observe(el, { childList: true, subtree: true });
  };
  watch("learnCard");

  // 点击单词可再次播放
  document.addEventListener("click", e => {
    const w = e.target.closest(".study-word");
    if (w) window.speakWord(w.textContent.trim());
  });
})();
