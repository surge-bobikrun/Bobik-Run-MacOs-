/* Bobik Run progression, rewards, achievements, missions and global hunt. */
(()=>{
'use strict';
const Core=window.BobikProgressCore;
if(!Core){console.error('Bobik progression core is missing');return;}
const cfg=Core.cfg,E=Core.E||Core.element,toast=Core.toast,save=Core.save,show=Core.showScreen;
const MODES=Core.modeNames,DIFFS=Core.diffNames;
const MAX_LEVEL=1000;
const levelThresholds=[0];
for(let level=1;level<MAX_LEVEL;level++) levelThresholds[level]=levelThresholds[level-1]+Math.floor(120+8*Math.pow(level,1.28));
const MAX_XP=levelThresholds[MAX_LEVEL-1];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayKey=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const weekKey=()=>{const d=new Date();const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));const y=t.getUTCFullYear(),s=new Date(Date.UTC(y,0,1));return y+'-'+String(Math.ceil((((t-s)/86400000)+1)/7)).padStart(2,'0')};
const getLevel=xp=>{xp=clamp(Math.floor(Number(xp)||0),0,MAX_XP);let lo=1,hi=MAX_LEVEL;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(levelThresholds[mid-1]<=xp)lo=mid;else hi=mid-1;}return lo;};
const levelInfo=xp=>{xp=clamp(Math.floor(Number(xp)||0),0,MAX_XP);const level=getLevel(xp),start=levelThresholds[level-1],end=level===MAX_LEVEL?MAX_XP:levelThresholds[level];return {level,xp,start,next:end,into:xp-start,needed:Math.max(0,end-start),percent:level===MAX_LEVEL?100:clamp((xp-start)/Math.max(1,end-start)*100,0,100)};};
function seeded(seed){let x=0;for(const c of String(seed))x=(x*31+c.charCodeAt(0))|0;return ()=>{x|=0;x=x+0x6D2B79F5|0;let t=Math.imul(x^x>>>15,1|x);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function ensureArray(v){return Array.isArray(v)?v:[];}
function initStats(){return {runs:0,totalDistance:0,bestRun:0,lastRun:0,modeRuns:[0,0,0,0],modeBest:[0,0,0,0],diffRuns:[0,0,0],questsCompleted:0,hunts:0};}
function rebalanceTask(task){
 if(!task||task.done)return task;
 const metric=String(task.metric||''),old=Math.max(0,Number(task.target)||0),daily=String(task.id||'').startsWith('daily_');
 if(metric==='lastRun'&&old<(daily?1500:2500)){task.target=daily?1500:2500;task.desc='Проедь '+task.target.toLocaleString('ru-RU')+' м за один забег';task.stars=daily?7:8;}
 else if(metric==='totalDistance'&&old<(daily?2500:6000)){task.target=daily?2500:6000;task.desc='Набери '+task.target.toLocaleString('ru-RU')+' м суммарно';task.stars=daily?5:7;}
 else if(metric==='runs'&&old<(daily?5:10)){task.target=daily?5:10;task.desc='Заверши '+task.target+' забегов';task.stars=daily?5:6;}
 else if(metric==='modeRuns'&&old<5){task.target=5;task.desc='Сыграй 5 раз в выбранном режиме';task.stars=7;}
 else if(metric==='diffRuns'&&old<5){task.target=5;task.desc='Сыграй 5 раз на выбранной сложности';task.stars=7;}
 return task;
}
function ensureState(){
 cfg.xp=clamp(Math.floor(Number(cfg.xp)||0),0,MAX_XP);cfg.level=getLevel(cfg.xp);
 cfg.ach=ensureArray(cfg.ach).filter(x=>typeof x==='string');
 cfg.stats=Object.assign(initStats(),cfg.stats||{});
 cfg.stats.modeRuns=Array.from({length:4},(_,i)=>Math.max(0,Number(cfg.stats.modeRuns?.[i])||0));
 cfg.stats.modeBest=Array.from({length:4},(_,i)=>Math.max(0,Number(cfg.stats.modeBest?.[i])||0));
 cfg.stats.diffRuns=Array.from({length:3},(_,i)=>Math.max(0,Number(cfg.stats.diffRuns?.[i])||0));
 cfg.stats.runs=Math.max(0,Number(cfg.stats.runs)||0);cfg.stats.totalDistance=Math.max(0,Number(cfg.stats.totalDistance)||0);cfg.stats.bestRun=Math.max(0,Number(cfg.stats.bestRun)||0);cfg.stats.questsCompleted=Math.max(0,Number(cfg.stats.questsCompleted)||0);cfg.stats.hunts=Math.max(0,Number(cfg.stats.hunts)||0);
 cfg.runHistory=ensureArray(cfg.runHistory).filter(r=>r&&Number.isFinite(Number(r.distance))).slice(-500);
 cfg.offlineHuntRecords=ensureArray(cfg.offlineHuntRecords);
 cfg.activeHunt=cfg.activeHunt&&cfg.activeHunt.id?cfg.activeHunt:{id:null,target_distance:6000,difficulty:2,difficulty_stars:8,title:'Глобальная охота'};cfg.activeHunts={global:cfg.activeHunts?.global||cfg.activeHunt};
 cfg.questData=cfg.questData&&typeof cfg.questData==='object'?cfg.questData:{};
 const q=cfg.questData;
 if(q.dailyDate!==todayKey()){q.dailyDate=todayKey();q.daily=generateDaily();}
 if(q.weeklyKey!==weekKey()||!Array.isArray(q.regular)||q.regular.length!==10){q.weeklyKey=weekKey();q.regular=generateRegular(10);}
 q.daily=ensureArray(q.daily).map(rebalanceTask);q.regular=ensureArray(q.regular).map(rebalanceTask);cfg.questData=q;
}
function rewardLevel(level){return 12+Math.floor(level*.35);}
function addXP(amount){
 const before=levelInfo(cfg.xp);const oldXp=cfg.xp;cfg.xp=clamp(cfg.xp+Math.max(0,Math.floor(Number(amount)||0)),0,MAX_XP);const after=levelInfo(cfg.xp);let reward=0;
 for(let l=before.level+1;l<=after.level;l++)reward+=rewardLevel(l);
 if(reward)cfg.c=(Number(cfg.c)||0)+reward;
 cfg.level=after.level;
 return {gained:cfg.xp-oldXp,oldLevel:before.level,level:after.level,levels:Math.max(0,after.level-before.level),levelCoins:reward,info:after};
}
const achievementList=[
 {id:'first_run',icon:'🚗',name:'Первый выезд',desc:'Заверши первый забег',tier:1,stars:1,xp:25,check:s=>s.runs>=1},
 {id:'run_10',icon:'🔟',name:'На постоянке',desc:'Заверши 25 забегов',tier:2,stars:3,xp:100,check:s=>s.runs>=25},
 {id:'run_50',icon:'🎮',name:'Ветеран дороги',desc:'Заверши 50 забегов',tier:2,stars:3,xp:100,check:s=>s.runs>=50},
 {id:'run_100',icon:'💯',name:'Сотня попыток',desc:'Заверши 100 забегов',tier:3,stars:4,xp:170,check:s=>s.runs>=100},
 {id:'run_250',icon:'🏁',name:'Без остановки',desc:'Заверши 250 забегов',tier:4,stars:6,xp:450,check:s=>s.runs>=250},
 {id:'run_500',icon:'👑',name:'Легенда трассы',desc:'Заверши 500 забегов',tier:5,stars:8,xp:1000,check:s=>s.runs>=500},
 {id:'run_1000',icon:'♾️',name:'Ты здесь живёшь',desc:'Заверши 1 000 забегов',tier:5,stars:10,xp:5000,check:s=>s.runs>=1000},
 {id:'dist_100',icon:'📍',name:'Разминка',desc:'Проедь 500 м за один забег',tier:1,stars:1,xp:25,check:s=>s.bestRun>=500},
 {id:'dist_500',icon:'🛣️',name:'Первые километры',desc:'Проедь 1 000 м за один забег',tier:1,stars:2,xp:50,check:s=>s.bestRun>=1000},
 {id:'dist_1k',icon:'🥉',name:'Километровый',desc:'Проедь 1 500 м за один забег',tier:2,stars:4,xp:170,check:s=>s.bestRun>=1500},
 {id:'dist_2500',icon:'🥈',name:'Дальнобойщик',desc:'Проедь 2 500 м за один забег',tier:3,stars:8,xp:1000,check:s=>s.bestRun>=2500},
 {id:'dist_5k',icon:'🥇',name:'Пять тысяч',desc:'Проедь 5 000 м за один забег',tier:4,stars:9,xp:2000,check:s=>s.bestRun>=5000},
 {id:'dist_10k',icon:'🌟',name:'Десять тысяч',desc:'Проедь 10 000 м за один забег',tier:5,stars:10,xp:5000,check:s=>s.bestRun>=10000},
 {id:'total_10k',icon:'🧭',name:'Исследователь',desc:'Набери 10 000 м суммарно',tier:2,stars:2,xp:50,check:s=>s.totalDistance>=10000},
 {id:'total_50k',icon:'🗺️',name:'Покоритель дорог',desc:'Набери 50 000 м суммарно',tier:3,stars:4,xp:170,check:s=>s.totalDistance>=50000},
 {id:'total_100k',icon:'🌍',name:'Вокруг света',desc:'Набери 100 000 м суммарно',tier:4,stars:6,xp:450,check:s=>s.totalDistance>=100000},
 {id:'total_500k',icon:'🪐',name:'Космический пробег',desc:'Набери 500 000 м суммарно',tier:5,stars:10,xp:5000,check:s=>s.totalDistance>=500000},
 {id:'hard_1k',icon:'☠️',name:'Проверка характера',desc:'Проедь 2 500 м в Хардкоре',tier:3,stars:5,xp:225,check:(s,r)=>r.mode===2&&r.distance>=2500},
 {id:'hard_3k',icon:'🔥',name:'Стальной характер',desc:'Проедь 4 000 м в Хардкоре',tier:4,stars:9,xp:2000,check:s=>s.modeBest[2]>=4000},
 {id:'night_1k',icon:'🌑',name:'Ночная смена',desc:'Проедь 2 500 м в Кошмаре',tier:3,stars:6,xp:450,check:(s,r)=>r.mode===3&&r.distance>=2500},
 {id:'night_3k',icon:'👁️',name:'Не смотри назад',desc:'Проедь 4 000 м в Кошмаре',tier:5,stars:10,xp:5000,check:s=>s.modeBest[3]>=4000},
 {id:'all_modes',icon:'🎭',name:'Универсал',desc:'Заверши по 10 забегов в каждом режиме',tier:3,stars:4,xp:170,check:s=>s.modeRuns.every(n=>n>=10)},
 {id:'hard_all',icon:'💀',name:'Любитель испытаний',desc:'Заверши 50 забегов на сложности «Сложно»',tier:4,stars:7,xp:800,check:s=>s.diffRuns[2]>=50},
 {id:'quest_25',icon:'📜',name:'Исполнитель',desc:'Выполни 25 заданий',tier:3,stars:5,xp:225,check:s=>s.questsCompleted>=25},
 {id:'quest_100',icon:'📚',name:'Мастер поручений',desc:'Выполни 100 заданий',tier:5,stars:9,xp:2000,check:s=>s.questsCompleted>=100}
];
function rawMetric(metric,mode){const s=cfg.stats||initStats();if(metric==='modeRuns')return s.modeRuns[clamp(mode|0,0,3)]||0;if(metric==='diffRuns')return s.diffRuns[clamp(mode|0,0,2)]||0;return Number(s[metric])||0;}
function genTask(id,title,desc,metric,target,rewardType,reward,difficulty,mode,stars){return {id,title,desc,metric,target,rewardType,reward,difficulty,stars:clamp(Number(stars)||3,1,10),mode:mode??-1,startValue:metric==='lastRun'?0:rawMetric(metric,mode),progress:0,done:false};}
function generateDaily(){
 const rng=seeded(todayKey()+'|'+(cfg.pn||'guest')+'|daily');
 const dist=2500+Math.floor(rng()*5)*500,runs=5+Math.floor(rng()*3),best=1500+Math.floor(rng()*4)*250;
 return [
  genTask('daily_dist_'+todayKey(),'Набрать дистанцию','Проедь суммарно '+dist.toLocaleString('ru-RU')+' м','totalDistance',dist,'xp',60+Math.floor(dist/50),'Лёгкое',-1,Math.min(5,Math.ceil(dist/400))),
  genTask('daily_runs_'+todayKey(),'Не сбавляй темп','Заверши '+runs+' забега','runs',runs,'coins',45+15*runs,'Лёгкое',-1,runs),
  genTask('daily_best_'+todayKey(),'Дальний заезд','Проедь '+best.toLocaleString('ru-RU')+' м за один забег','lastRun',best,'xp',70+Math.floor(best/20),'Среднее',-1,Math.min(7,Math.ceil(best/150)))
 ];
}
function generateRegular(count){
 const rng=seeded(weekKey()+'|'+(cfg.pn||'guest')+'|'+(cfg.questData?.serial||0));
 const out=[],modes=[0,1,2,3];
 for(let i=0;i<count;i++){
  const kind=i%6,mode=modes[Math.floor(rng()*4)],hard=Math.floor(rng()*3);let q;
  if(kind===0){const target=6000+Math.floor(rng()*7)*1000;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Большой пробег','Набери '+target.toLocaleString('ru-RU')+' м суммарно','totalDistance',target,'xp',80+Math.floor(target/60),'Среднее',-1,Math.min(7,Math.ceil(target/650)));}
  else if(kind===1){const target=8+Math.floor(rng()*5);q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Опытный водитель','Заверши '+target+' забегов','runs',target,'coins',60+target*12,'Среднее',-1,Math.min(7,target));}
  else if(kind===2){const target=2000+Math.floor(rng()*9)*250;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Планка дальности','Проедь '+target.toLocaleString('ru-RU')+' м за один забег','lastRun',target,'xp',90+Math.floor(target/15),'Сложное',-1,Math.min(9,Math.ceil(target/180)));}
  else if(kind===3){const target=5+Math.floor(rng()*4);q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Режимная работа','Сыграй '+target+' раз: '+MODES[mode],'modeRuns',target,rng()<.5?'xp':'coins',70+target*18,'Среднее',mode,Math.min(7,target+2));}
  else if(kind===4){const target=5+Math.floor(rng()*4);q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Сложная полоса','Сыграй '+target+' раз на сложности «'+DIFFS[hard]+'»','diffRuns',target,'xp',75+target*20,'Среднее',hard,Math.min(8,target+2));}
  else {const target=2000+Math.floor(rng()*9)*250;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Рекордный заезд','Проедь '+target.toLocaleString('ru-RU')+' м за один забег','lastRun',target,'coins',80+Math.floor(target/20),'Сложное',-1,Math.min(9,Math.ceil(target/180)));}
  out.push(q);
 }
 return out;
}
function getMetric(task){const raw=rawMetric(task.metric,task.mode);return task.metric==='lastRun'?raw:Math.max(0,raw-(Number(task.startValue)||0));}
function progressTasks(){const q=cfg.questData;let xp=0,coins=0,done=[];
 const update=(task,isRegular,index)=>{const current=getMetric(task);task.progress=task.metric==='lastRun'?Math.max(Number(task.progress)||0,current):current;if(task.done||task.progress<task.target)return;task.done=true;cfg.stats.questsCompleted++;if(task.rewardType==='coins'){coins+=task.reward;cfg.c=(Number(cfg.c)||0)+task.reward;}else{xp+=task.reward;}done.push(task.title);if(isRegular){q.regular[index]=generateReplacement(index);}};
 (q.daily||[]).forEach(t=>update(t,false,0));(q.regular||[]).forEach((t,i)=>update(t,true,i));
 return {xp,coins,done};
}
function generateReplacement(index){
 const q=cfg.questData;q.serial=(Number(q.serial)||0)+1;const base=generateRegular(10);const used=new Set((q.regular||[]).map(x=>x?.id));return base.find(x=>!used.has(x.id))||base[index%base.length];
}
function awardAchievements(run){let xp=0,unlocked=[];for(const a of achievementList){if(cfg.ach.includes(a.id))continue;let ok=false;try{ok=!!a.check(cfg.stats,run)}catch(_){ }if(ok){cfg.ach.push(a.id);xp+=a.xp;unlocked.push(a);}}
 if(unlocked.length)cfg.ach=Array.from(new Set(cfg.ach));return {xp,unlocked};}
function awardHuntAchievements(){const result=awardAchievements({mode:clamp(Number(cfg.m)||0,0,3),difficulty:clamp(Number(cfg.d)||0,0,2),distance:0});let gained=0,levelCoins=0;if(result.xp){const r=addXP(result.xp);gained=r.gained;levelCoins=r.levelCoins;}if(result.unlocked.length)toast('🏅 Новое достижение: '+result.unlocked[0].name);return {xp:gained,levelCoins,unlocked:result.unlocked};}
function hardestAchievements(ids,count=3){return achievementList.filter(a=>ids.includes(a.id)).sort((a,b)=>b.tier-a.tier||b.xp-a.xp).slice(0,count);}
function syncCloud(){save();try{window.BobikCloudApi?.syncProgress?.(cfg.xp,cfg.ach)?.catch?.(e=>console.warn('Progress sync failed',e));}catch(e){console.warn('Progress sync failed',e);}}
function processRun(distance,mode,diff,baseCoins){
 ensureState();distance=Math.max(0,Math.floor(Number(distance)||0));mode=clamp(mode|0,0,3);diff=clamp(diff|0,0,2);
 const s=cfg.stats;s.runs++;s.totalDistance+=distance;s.lastRun=distance;s.bestRun=Math.max(s.bestRun,distance);s.modeRuns[mode]++;s.modeBest[mode]=Math.max(s.modeBest[mode],distance);s.diffRuns[diff]++;
 const record={mode,difficulty:diff,distance,created_at:new Date().toISOString()};cfg.runHistory.push(record);cfg.runHistory=cfg.runHistory.slice(-500);
 const oldLevel=getLevel(cfg.xp);const runXP=Math.floor(distance/10*[.9,1,1.15][diff]*[1,1.05,1.12,1.2][mode]);
 const bonusCoins=Math.floor(runXP*(.08+Math.min(1000,oldLevel)*.00016));cfg.c=(Number(cfg.c)||0)+bonusCoins;
 const missions=progressTasks();const coinXP=Math.floor((Math.max(0,Number(baseCoins)||0)+bonusCoins+missions.coins)*(2+Math.max(0,oldLevel-1)*0.01));
 let xpTotal=0,levelCoins=0;const xpRun=addXP(runXP+coinXP);xpTotal+=xpRun.gained;levelCoins+=xpRun.levelCoins;
 if(missions.xp){const r=addXP(missions.xp);xpTotal+=r.gained;levelCoins+=r.levelCoins;}
 const achievements=awardAchievements({mode,difficulty:diff,distance});if(achievements.xp){const r=addXP(achievements.xp);xpTotal+=r.gained;levelCoins+=r.levelCoins;}
 const level=getLevel(cfg.xp);cfg.level=level;cfg.lastRunXP=xpTotal;cfg.lastRunDate=Date.now();
 try{window.BobikCloudApi?.recordRun?.(mode,diff,distance)?.catch?.(e=>console.warn('Run history sync failed',e));}catch(e){console.warn('Run history sync failed',e);}
 syncCloud();
 renderMenuProgress();
 if(E('profileLevel')&&!E('prof').classList.contains('hide'))renderOwnProfile();
 if(achievements.unlocked.length)toast('🏅 Новое достижение: '+achievements.unlocked[0].name);
 if(missions.done.length)toast('📋 Выполнено заданий: '+missions.done.length);
 const earned=Math.max(0,Math.floor(Number(baseCoins)||0))+bonusCoins+levelCoins+missions.coins;
 const result={earned,baseCoins:Math.floor(Number(baseCoins)||0),bonusCoins,coinXP,xp:xpTotal,runXP,missionXP:missions.xp,achievementXP:achievements.xp,levelCoins,missionCoins:missions.coins,level,levels:Math.max(0,level-oldLevel),unlocked:achievements.unlocked,completed:missions.done,info:levelInfo(cfg.xp)};
 attemptHunt(distance,result,mode);
 return result;
}
 function attemptHunt(distance,result,mode){
  const hunt=(cfg.runHunts?.global||cfg.activeHunts?.global||cfg.activeHunt);cfg.runHunts=null;
  if(mode!==0||!hunt?.id||distance<(Number(hunt.target_distance)||6000)||window.BobikCloudApi?.isAuthenticated?.())return;
  const target=Number(hunt.target_distance)||6000,reward=10000;
  const add=addXP(reward);cfg.offlineHuntRecords.push({name:cfg.pn||'Игрок',target_distance:target,actual_distance:distance,created_at:new Date().toISOString()});
  setActiveHunt({id:null,target_distance:6000,difficulty:2,difficulty_stars:8,mode:0,title:'Глобальная охота'});
  toast('🌍 Глобальная охота выполнена! +'+reward.toLocaleString('ru-RU')+' XP');
  if(E('res')&&!E('over').classList.contains('hide'))E('res').insertAdjacentHTML('beforeend','<article class="result-stat wide hunt-result"><span class="stat-label">🌍 Глобальная охота (офлайн)</span><b class="stat-value">+'+reward.toLocaleString('ru-RU')+' XP</b><small class="stat-extra">Результат не попадёт в общую таблицу без подключения к Supabase · уровень '+add.level+'</small></article>');
 }
 function setActiveHunt(row){if(!row)return;const value={id:row.hunt_id||row.id||null,target_distance:Number(row.target_distance)||6000,difficulty:Number(row.difficulty)||2,difficulty_stars:Number(row.difficulty_stars)||8,mode:0,title:row.title||'Глобальная охота',created_at:row.created_at||null};cfg.activeHunts={global:value};cfg.activeHunt=value;delete cfg.activeNormalHunt;save();renderHunt();}
function setActiveHunts(rows){const row=(rows||[]).find(r=>Number(r.id)===1)||(rows||[])[0];if(row)setActiveHunt(row);else{cfg.activeHunts={global:cfg.activeHunt};}save();}

function renderMenuProgress(){const p=levelInfo(cfg.xp);const level=E('menuLevel');if(!level)return;level.textContent='⭐ УРОВЕНЬ '+p.level.toLocaleString('ru-RU');E('menuXpText').textContent=p.level===MAX_LEVEL?'МАКСИМАЛЬНЫЙ УРОВЕНЬ':p.into.toLocaleString('ru-RU')+' / '+p.needed.toLocaleString('ru-RU')+' XP';E('menuXpFill').style.width=p.percent+'%';E('menuXpPercent').textContent=p.level===MAX_LEVEL?'MAX':Math.floor(p.percent)+'%';if(E('vr'))E('vr').innerHTML='v1.9.4<br>⭐ Ур. '+p.level+' · 🪙 '+Math.floor(cfg.c||0)+' · 🏆 '+Math.max(...(cfg.r||[0]))+' м';}
function rewardTabs(active){return '<div class="reward-tabs"><button data-rt="ach" class="'+(active==='ach'?'on':'')+'">🏅 Достижения</button><button data-rt="tasks" class="'+(active==='tasks'?'on':'')+'">📋 Задания</button><button data-rt="hunt" class="'+(active==='hunt'?'on':'')+'">🌍 Охота</button></div>';}
let rewardTab='ach',huntSubtab='about';
function renderAchievements(){const unlocked=new Set(cfg.ach);const list=achievementList.map(a=>{const got=unlocked.has(a.id);return '<article class="achievement-card '+(got?'unlocked':'locked')+' tier-'+a.tier+'"><div class="achievement-icon">'+a.icon+'</div><div class="achievement-info"><b>'+escapeHtml(a.name)+'</b><span>'+escapeHtml(a.desc)+'</span>'+starRating(a.stars)+'<small>'+(got?'Получено':'Заблокировано')+' · +'+a.xp+' XP</small></div><i class="achievement-state">'+(got?'✓':'🔒')+'</i></article>';}).join('');return '<div class="rewards-summary"><b>Открыто: '+unlocked.size+' / '+achievementList.length+'</b><span>Сложность — по шкале из 10 звёзд</span></div><div class="achievement-list">'+list+'</div>'; }
function starRating(value){const n=clamp(Math.round(Number(value)||1),1,10);return '<span class="difficulty-stars" aria-label="Сложность '+n+' из 10">'+('★'.repeat(n))+('<span class="star-empty">'+('☆'.repeat(10-n))+'</span>')+'</span>'; }
function taskCard(t){const pct=clamp(t.progress/Math.max(1,t.target)*100,0,100),stars=t.stars||Math.max(1,Math.min(10,Math.round((Number(t.target)||1)/250)));return '<article class="quest-card '+(t.done?'done':'')+'"><div class="quest-top"><b>'+escapeHtml(t.title)+'</b>'+starRating(stars)+'</div><p>'+escapeHtml(t.desc)+'</p><div class="quest-progress"><i style="width:'+pct+'%"></i></div><div class="quest-bottom"><span>'+Math.floor(t.progress).toLocaleString('ru-RU')+' / '+t.target.toLocaleString('ru-RU')+'</span><b>'+(t.rewardType==='xp'?'⭐ ':'🪙 ')+t.reward.toLocaleString('ru-RU')+' '+(t.rewardType==='xp'?'XP':'монет')+'</b></div>'+(t.done?'<small class="quest-done">✓ Выполнено</small>':'')+'</article>'; }
function renderTasks(){const q=cfg.questData;return '<div class="quest-section"><h3>☀️ Ежедневные задания <small>Обновляются каждый день</small></h3>'+q.daily.map(taskCard).join('')+'</div><div class="quest-section"><h3>🧩 Дополнительные задания <small>10 активных · новые появляются после выполнения</small></h3>'+q.regular.map(taskCard).join('')+'</div>';}
async function renderHuntLeaderboard(){
 const box=E('huntContent');if(!box)return;box.innerHTML='<p class="reward-muted">Загружаю прогресс охот…</p>';
 const api=window.BobikCloudApi,hunt=(cfg.activeHunts||{}).global||cfg.activeHunt;
 try{
  const validUuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const [rows,history]=await Promise.all([validUuid(hunt?.id)?api?.huntProgress?.(hunt.id):Promise.resolve([]),api?.huntCompletions?.()]);
  if(!rows||!history)throw new Error('progress unavailable');
  const section='<section class="hunt-progress-section"><h3>🌍 Глобальная охота · 6 000 м</h3>'+(rows.length?rows.map((r,i)=>{const pct=Math.max(0,Math.min(100,Number(r.progress_percent)||0));return '<div class="hunt-progress-row"><div class="hunt-progress-top"><b>'+(i+1)+'. '+escapeHtml(r.display_name||'Игрок')+'</b><strong>'+pct.toFixed(0)+'% '+(r.completed?'✓':'')+'</strong></div><div class="quest-progress"><i style="width:'+pct+'%"></i></div><small>'+Number(r.best_distance||0).toLocaleString('ru-RU')+' / 6 000 м · '+Number(r.attempts||0)+' попыток'+(r.completed?' · Выполнено':'')+'</small></div>';}).join(''):'<p class="reward-muted">Пока никто не начал это задание.</p>')+'</section>';
  box.innerHTML='<div class="rewards-summary"><b>Одна общая цель для всех игроков</b><span>Засчитывается забег в режиме «Обычный» от 6 000 м</span></div>'+section+(history.length?'<section class="hunt-progress-section"><h3>🏆 Кто уже выполнил задание</h3>'+history.slice(0,20).map((r,i)=>'<div class="leader-row"><b>'+(i+1)+'. '+escapeHtml(r.display_name||'Игрок')+'</b><span><b class="hunt-percent">'+Number(r.completion_percent||0).toFixed(0)+'%</b> · '+Number(r.actual_distance||0).toLocaleString('ru-RU')+' / '+Number(r.target_distance||0).toLocaleString('ru-RU')+' м</span></div>').join('')+'</section>':'<p class="reward-muted">Пока нет выполненных охот.</p>');
 }catch(e){box.innerHTML='<p class="reward-muted">Не удалось загрузить прогресс охот: '+escapeHtml(e.message||'ошибка')+'</p>';}
}
function renderHunt(){const box=E('huntAbout');if(!box)return;const h=(cfg.activeHunts||{}).global||cfg.activeHunt||{target_distance:6000,title:'Глобальная охота'};const target=6000;box.innerHTML='<div class="hunt-hero"><div class="hunt-globe">🌍</div><span class="hunt-kicker">ОБЩЕЕ ЗАДАНИЕ · РЕЖИМ «ОБЫЧНЫЙ»</span><h3>'+escapeHtml(h.title||'Глобальная охота')+'</h3><b class="hunt-target">6 000 <small>МЕТРОВ</small></b><p>Проедь 6 000 м за один забег в обычном режиме. Награда за выполнение — 10 000 XP.</p><div class="hunt-meta"><span>Сложность: '+starRating(8)+'</span><span>Награда: 10 000 XP</span></div></div><p class="hunt-note">В таблице охотников отображаются результаты выполнения общей цели</p>';}

function renderRewards(){ensureState();const nav=E('rewardNav'),content=E('rewardContent');if(!nav||!content)throw new Error('Не найдены контейнеры наград');nav.innerHTML=rewardTabs(rewardTab);content.innerHTML=rewardTab==='ach'?renderAchievements():rewardTab==='tasks'?renderTasks():'<div class="hunt-subtabs"><button data-hunt-tab="about" class="'+(huntSubtab==='about'?'on':'')+'">Текущая охота</button><button data-hunt-tab="board" class="'+(huntSubtab==='board'?'on':'')+'">🏆 Таблица охотников</button></div><div id="huntAbout" class="hunt-content '+(huntSubtab==='about'?'':'hide')+'"></div><div id="huntContent" class="hunt-content '+(huntSubtab==='board'?'':'hide')+'"></div>';
 if(rewardTab==='hunt'){renderHunt();if(huntSubtab==='board')renderHuntLeaderboard();}
}
function showRewards(tab){rewardTab=tab||'ach';if(!E('rewards'))initRewardsMarkup();show('rewards');try{renderRewards()}catch(err){console.error('Rewards rendering failed:',err);const box=E('rewardContent');if(box)box.innerHTML='<p class="reward-muted">Не удалось отобразить награды: '+String(err.message||err)+'</p>';}if(rewardTab==='hunt'){try{window.BobikCloudApi?.refreshHunt?.().then(()=>{if(!E('rewards').classList.contains('hide')&&rewardTab==='hunt')renderRewards();}).catch(()=>{});}catch(_){}}}
function bestLocalRuns(mode,diff){const rows=cfg.runHistory.filter(r=>Number(r.mode)===mode&&Number(r.difficulty)===diff).slice();const legacyDiff=Number(cfg.lr?.[mode]?.[diff])||0,legacyMode=Number(cfg.r?.[mode])||0;if(legacyDiff>0&&!rows.some(r=>Number(r.distance)===legacyDiff))rows.push({distance:legacyDiff,created_at:null,legacy:true});if(diff===0&&legacyMode>0&&!rows.some(r=>Number(r.distance)===legacyMode))rows.push({distance:legacyMode,created_at:null,legacy:true,legacyMode:true});return rows.sort((a,b)=>Number(b.distance)-Number(a.distance)).slice(0,10);}
function recordSelector(prefix,mode,diff){const options=mode===3?'<button data-record-diff="2" data-prefix="'+prefix+'" class="on">Сложно</button>':DIFFS.map((n,i)=>'<button data-record-diff="'+i+'" data-prefix="'+prefix+'" class="'+(i===diff?'on':'')+'">'+n+'</button>').join('');return '<div class="profile-record-selector"><div class="profile-mode-switch"><button data-record-step="-1" data-prefix="'+prefix+'">‹</button><b id="'+prefix+'Mode">'+MODES[mode]+'</b><button data-record-step="1" data-prefix="'+prefix+'">›</button></div><div class="profile-diff-tabs">'+options+'</div></div>';}
let ownMode=0,ownDiff=1,pubMode=0,pubDiff=1,publicProfileId=null;
function achievementBadges(ids){const top=hardestAchievements(ids,3);return top.length?'<div class="profile-achievements">'+top.map(a=>'<div class="profile-achievement" title="'+escapeHtml(a.name)+'"><span>'+a.icon+'</span><b>'+escapeHtml(a.name)+'</b></div>').join('')+'</div>':'<p class="reward-muted">Пока нет открытых достижений.</p>';}
function levelCard(info){if(!info)return '<div class="profile-level"><b>⭐ Уровень не загружен</b></div>';const p=levelInfo(Number(info.xp)||0);return '<div class="profile-level"><div><b>⭐ УРОВЕНЬ '+p.level.toLocaleString('ru-RU')+'</b><span>'+Number(info.xp||0).toLocaleString('ru-RU')+' XP</span></div><div class="level-bar"><i style="width:'+p.percent+'%"></i></div><small>'+(p.level===MAX_LEVEL?'Достигнут максимум':(p.next-Number(info.xp||0)).toLocaleString('ru-RU')+' XP до следующего уровня')+'</small></div>';}
function recordList(rows){return rows.length?'<div class="profile-run-list">'+rows.map((r,i)=>'<div class="profile-run"><b>'+(i+1)+'. '+Number(r.distance).toLocaleString('ru-RU')+' м</b><span>'+(r.legacy?(r.legacyMode?'Старый рекорд режима (сложность не сохранена)':'Сохранено из прошлой версии'):new Date(r.created_at||Date.now()).toLocaleDateString('ru-RU'))+'</span></div>').join('')+'</div>':'<p class="reward-muted">Для этого режима и сложности пока нет забегов.</p>';}
async function renderOwnRuns(){const box=E('ownRunRows');if(!box)return;box.innerHTML='<p class="reward-muted">Загрузка рекордов…</p>';let rows=bestLocalRuns(ownMode,ownDiff);try{const cloudRows=await window.BobikCloudApi?.getRuns?.(ownMode,ownDiff);if(cloudRows?.length){const merged=[...cloudRows,...rows.filter(r=>r.legacy)];const seen=new Set();rows=merged.filter(r=>{const k=String(r.distance)+'|'+String(r.created_at||'legacy');if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>Number(b.distance)-Number(a.distance)).slice(0,10);}}catch(_){}box.innerHTML=recordList(rows);}
async function renderOwnProfile(){ensureState();const info=levelInfo(cfg.xp);E('profileLevel').innerHTML=levelCard({xp:cfg.xp});E('profileAch').innerHTML=achievementBadges(cfg.ach);E('ownRecordsTitle').textContent=MODES[ownMode]+' · '+DIFFS[ownDiff];E('ownRunSelector').innerHTML=recordSelector('own',ownMode,ownDiff);renderOwnRuns();}
async function renderPublicProfile(uid){publicProfileId=uid;const levelBox=E('publicLevel'),achBox=E('publicAch'),rowsBox=E('publicRunRows');if(levelBox)levelBox.innerHTML='<p class="reward-muted">Загружаю уровень…</p>';if(achBox)achBox.innerHTML='';if(rowsBox)rowsBox.innerHTML='<p class="reward-muted">Загружаю рекорды…</p>';
 try{const prog=await window.BobikCloudApi?.getProgress?.(uid);if(levelBox)levelBox.innerHTML=prog?levelCard(prog):'<p class="reward-muted">Уровень ещё не синхронизирован.</p>';if(achBox)achBox.innerHTML=achievementBadges(prog?.achievements||[]);}catch(_){if(levelBox)levelBox.innerHTML='<p class="reward-muted">Не удалось загрузить уровень.</p>';if(achBox)achBox.innerHTML='<p class="reward-muted">Не удалось загрузить достижения.</p>'; }
 renderPublicRuns();
}
async function renderPublicRuns(){const box=E('publicRunRows');if(!box||!publicProfileId)return;box.innerHTML='<p class="reward-muted">Загрузка рекордов…</p>';let rows=[];try{rows=await window.BobikCloudApi?.getRuns?.(pubMode,pubDiff,publicProfileId)||[];}catch(_){}box.innerHTML=recordList(rows);E('publicRecordsTitle').textContent=MODES[pubMode]+' · '+DIFFS[pubDiff];E('publicRunSelector').innerHTML=recordSelector('pub',pubMode,pubDiff);}
function initProfileMarkup(){
 const profile=E('prof');
 if(profile&&!E('profileLevel')){
  const markup='<section class="profile-progression"><h3>⭐ Прогресс уровня</h3><div id="profileLevel"></div><h3>🏅 Три самых сложных достижения</h3><div id="profileAch"></div><h3>🏁 Таблица личных рекордов</h3><p id="ownRecordsTitle" class="reward-muted">Выбери режим и сложность.</p><div id="ownRunSelector"></div><div id="ownRunRows"></div></section>';
  const sec=profile.querySelector('.account-security');if(sec)sec.insertAdjacentHTML('beforebegin',markup);else profile.insertAdjacentHTML('beforeend',markup);
 }
 const pub=E('pubp');
 if(pub&&!E('publicLevel')){
  const markup='<section class="profile-progression public-progression"><h3>⭐ Уровень</h3><div id="publicLevel"></div><h3>🏅 Лучшие достижения</h3><div id="publicAch"></div><h3>🏁 Лучшие забеги</h3><p id="publicRecordsTitle" class="reward-muted"></p><div id="publicRunSelector"></div><div id="publicRunRows"></div></section>';
  const back=pub.querySelector('#pubBack');if(back)back.insertAdjacentHTML('beforebegin',markup);else pub.insertAdjacentHTML('beforeend',markup);
 }
}
function initMenuMarkup(){
 const menu=E('menu');
 if(!E('menuProgress')){
  const tag=menu.querySelector('.tg');
  if(tag)tag.insertAdjacentHTML('afterend','<button id="menuProgress" class="menu-progress" data-go="rewards"><div class="menu-progress-top"><b id="menuLevel">⭐ УРОВЕНЬ 1</b><span id="menuXpPercent">0%</span></div><div class="menu-progress-bar"><i id="menuXpFill"></i></div><div class="menu-progress-bottom"><span id="menuXpText">0 / 128 XP</span><small>Награды →</small></div></button>');
 }
 // One single Rewards entry point; achievements, missions and hunt live inside it.
 menu.querySelectorAll('[data-go="rewards"][data-reward-open="tasks"]').forEach(b=>b.remove());
 const oldQuestion=menu.querySelector('.newbtn');
 if(oldQuestion){oldQuestion.textContent='?';oldQuestion.setAttribute('aria-label','Что нового');oldQuestion.title='Что нового';oldQuestion.dataset.go='log';}
 else menu.insertAdjacentHTML('beforeend','<button class="newbtn" data-go="log" aria-label="Что нового" title="Что нового">?</button>');
 const oldNews=menu.querySelector('[data-go="news"]');
 if(oldNews){oldNews.id='newsSide';oldNews.innerHTML='<span>📰</span>';oldNews.setAttribute('aria-label','Новости');oldNews.title='Новости';}
 else menu.insertAdjacentHTML('beforeend','<button id="newsSide" class="news-side" data-go="news" aria-label="Новости" title="Новости"><span>📰</span></button>');
 if(!menu.querySelector('[data-go="rewards"]'))menu.insertAdjacentHTML('beforeend','<button class="b g" data-go="rewards"><i>🎁</i>Награды</button>');
}

function initRewardsMarkup(){
 if(E('rewards'))return;
 document.body.insertAdjacentHTML('beforeend','<div id="rewards" class="scr hide"><h2>🎁 Награды</h2><p class="rewards-intro">Получай XP, повышай уровень и открывай награды.</p><div id="rewardNav"></div><div id="rewardContent"></div><button class="b" data-go="menu">Назад</button></div>');
}
function init(){ensureState();initMenuMarkup();initRewardsMarkup();initProfileMarkup();renderMenuProgress();
 document.addEventListener('click',e=>{
  const rt=e.target.closest('[data-rt]');if(rt){rewardTab=rt.dataset.rt;renderRewards();return;}
  const ht=e.target.closest('[data-hunt-tab]');if(ht){huntSubtab=ht.dataset.huntTab;renderRewards();return;}
  const step=e.target.closest('[data-record-step]');if(step){const p=step.dataset.prefix;if(p==='own'){ownMode=(ownMode+Number(step.dataset.recordStep)+4)%4;if(ownMode===3)ownDiff=2;renderOwnProfile();}else{pubMode=(pubMode+Number(step.dataset.recordStep)+4)%4;if(pubMode===3)pubDiff=2;renderPublicRuns();}return;}
  const dif=e.target.closest('[data-record-diff]');if(dif){if(dif.dataset.prefix==='own'){ownDiff=ownMode===3?2:Number(dif.dataset.recordDiff);renderOwnProfile();}else{pubDiff=pubMode===3?2:Number(dif.dataset.recordDiff);renderPublicRuns();}return;}
  const go=e.target.closest('[data-go="rewards"]');if(go){showRewards(go.dataset.rewardOpen||'ach');}
 });
 const previous=window.sd2;window.sd2=function(){previous&&previous();renderMenuProgress();};
 const previousPrf=window.prf; // profile is rendered by the original closure; hook navigation below instead.
 document.addEventListener('click',e=>{const b=e.target.closest('[data-go="prof"]');if(b)setTimeout(renderOwnProfile,0);});
 const back=E('pubBack');if(back)back.addEventListener('click',()=>{publicProfileId=null;});
 if(window.__BobikActiveHunts)setActiveHunts(window.__BobikActiveHunts);else if(window.__BobikActiveHunt)setActiveHunt(window.__BobikActiveHunt);
 const info=levelInfo(cfg.xp);cfg.level=info.level;save();
}
window.BobikProgress={processRun,onRunStart(){cfg.runHunts={global:{...(cfg.activeHunts?.global||cfg.activeHunt||{})}};},setActiveHunt,showRewards,renderRewards,renderMenuProgress,renderOwnProfile,renderPublicProfile,renderPublicRuns,getLevelInfo:()=>levelInfo(cfg.xp),hardestAchievements,achievementList};
try{
 init();
 window.BobikProgressReady=true;
}catch(initError){
 window.BobikProgressReady=false;
 console.error('Bobik progression initialization failed:',initError);
 const box=E('rewardContent');if(box)box.innerHTML='<p class="reward-muted">Ошибка загрузки наград: '+String(initError.message||initError)+'</p>';
}
})();