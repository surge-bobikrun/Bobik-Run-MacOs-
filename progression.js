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
function rebalanceTask(task,isRegular=false){
 if(!task||task.done)return task;
 const metric=String(task.metric||''),old=Math.max(0,Number(task.target)||0);
 if(isRegular){
  if(metric==='totalDistance'&&old<20000){task.target=20000;task.desc='Набери 20 000 м суммарно';}
  else if(metric==='runs'&&old<12){task.target=12;task.desc='Заверши 12 забегов';}
  else if(metric==='lastRun'&&old<3500){task.target=3500;task.desc='Проедь 3 500 м за один забег';}
  else if(metric==='modeRuns'&&old<8){task.target=8;task.desc='Сыграй 8 раз в выбранном режиме';}
  else if(metric==='diffRuns'&&old<8){task.target=8;task.desc='Сыграй 8 раз на выбранной сложности';}
  if(metric==='totalDistance')task.reward=old>=30000?65:45;
  else if(metric==='runs')task.reward=45;
  else if(metric==='lastRun')task.reward=old>=4500?80:70;
  else if(metric==='modeRuns')task.reward=55;
  else if(metric==='diffRuns')task.reward=60;
 }else{
  if(metric==='totalDistance'&&old<5000){task.target=5000;task.desc='Набери 5 000 м суммарно';}
  else if(metric==='runs'&&old<8){task.target=8;task.desc='Заверши 8 забегов';}
  else if(metric==='lastRun'&&old<2000){task.target=2000;task.desc='Проедь 2 000 м за один забег';}
  if(metric==='totalDistance')task.reward=35;
  else if(metric==='runs')task.reward=30;
  else if(metric==='lastRun')task.reward=45;
 }
 task.stars=clamp(Number(task.stars)||5,1,10);
 return task;
}
function ensureState(){
 cfg.xp=clamp(Math.floor(Number(cfg.xp)||0),0,MAX_XP);cfg.level=getLevel(cfg.xp);
 cfg.ach=ensureArray(cfg.ach).filter(x=>typeof x==='string'&&x!=='hunt_1'&&x!=='hunt_10');
 cfg.stats=Object.assign(initStats(),cfg.stats||{});
 cfg.stats.modeRuns=Array.from({length:4},(_,i)=>Math.max(0,Number(cfg.stats.modeRuns?.[i])||0));
 cfg.stats.modeBest=Array.from({length:4},(_,i)=>Math.max(0,Number(cfg.stats.modeBest?.[i])||0));
 cfg.stats.diffRuns=Array.from({length:3},(_,i)=>Math.max(0,Number(cfg.stats.diffRuns?.[i])||0));
 cfg.stats.runs=Math.max(0,Number(cfg.stats.runs)||0);cfg.stats.totalDistance=Math.max(0,Number(cfg.stats.totalDistance)||0);cfg.stats.bestRun=Math.max(0,Number(cfg.stats.bestRun)||0);cfg.stats.questsCompleted=Math.max(0,Number(cfg.stats.questsCompleted)||0);cfg.stats.hunts=Math.max(0,Number(cfg.stats.hunts)||0);
 cfg.runHistory=ensureArray(cfg.runHistory).filter(r=>r&&Number.isFinite(Number(r.distance))).slice(-500);
 cfg.offlineHuntRecords=ensureArray(cfg.offlineHuntRecords);
 cfg.activeHunt=cfg.activeHunt&&cfg.activeHunt.id?cfg.activeHunt:{id:'offline-global-default',title:'БЕГИ',icon:'👁️',objective:'Проедь 3000 м в режиме Кошмара',target_distance:3000,difficulty:2,difficulty_stars:8,mode:3,sequence_index:1,hold_hours:10};cfg.activeHunts={global:cfg.activeHunt};delete cfg.activeNormalHunt;
 cfg.questData=cfg.questData&&typeof cfg.questData==='object'?cfg.questData:{};
 const q=cfg.questData;
 if(q.dailyDate!==todayKey()){q.dailyDate=todayKey();q.daily=generateDaily();}
 if(q.weeklyKey!==weekKey()||!Array.isArray(q.regular)||q.regular.length!==10){q.weeklyKey=weekKey();q.regular=generateRegular(10);}
 q.daily=ensureArray(q.daily).map(task=>rebalanceTask(task,false));q.regular=ensureArray(q.regular).map((task,index)=>{const due=Number(task?.nextAt)||Date.parse(task?.nextAt||'')||0;if(task?.done&&due>0&&Date.now()>=due)return generateReplacement(index);return rebalanceTask(task,true);});cfg.questData=q;
}
function starReward(stars){return [0,25,50,100,170,225,450,800,1000,2000,5000][clamp(Math.round(Number(stars)||1),1,10)];}
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
 {id:'run_10',icon:'🔟',name:'На постоянке',desc:'Заверши 10 забегов',tier:1,stars:2,xp:50,check:s=>s.runs>=10},
 {id:'run_50',icon:'🎮',name:'Ветеран дороги',desc:'Заверши 50 забегов',tier:2,stars:3,xp:125,check:s=>s.runs>=50},
 {id:'run_100',icon:'💯',name:'Сотня попыток',desc:'Заверши 100 забегов',tier:3,stars:4,xp:200,check:s=>s.runs>=100},
 {id:'run_250',icon:'🏁',name:'Без остановки',desc:'Заверши 250 забегов',tier:4,stars:6,xp:350,check:s=>s.runs>=250},
 {id:'run_500',icon:'👑',name:'Легенда трассы',desc:'Заверши 500 забегов',tier:5,stars:8,xp:650,check:s=>s.runs>=500},
 {id:'run_1000',icon:'♾️',name:'Ты здесь живёшь',desc:'Заверши 1000 забегов',tier:5,stars:10,xp:1000,check:s=>s.runs>=1000},
 {id:'dist_100',icon:'📍',name:'Разминка',desc:'Проедь 100 м за один забег',tier:1,stars:1,xp:15,check:s=>s.bestRun>=100},
 {id:'dist_500',icon:'🛣️',name:'Первые километры',desc:'Проедь 500 м за один забег',tier:1,stars:2,xp:25,check:s=>s.bestRun>=500},
 {id:'dist_1k',icon:'🥉',name:'Километровый',desc:'Проедь 1 000 м за один забег',tier:2,stars:4,xp:60,check:s=>s.bestRun>=1000},
 {id:'dist_2500',icon:'🥈',name:'Дальнобойщик',desc:'Проедь 2 500 м за один забег',tier:3,stars:8,xp:200,check:s=>s.bestRun>=2500},
 {id:'dist_5k',icon:'🥇',name:'Пять тысяч',desc:'Проедь 5 000 м за один забег',tier:4,stars:9,xp:300,check:s=>s.bestRun>=5000},
 {id:'dist_10k',icon:'🌟',name:'Десять тысяч',desc:'Проедь 10 000 м за один забег',tier:5,stars:10,xp:1000,check:s=>s.bestRun>=10000},
 {id:'total_10k',icon:'🧭',name:'Исследователь',desc:'Набери 10 000 м суммарно',tier:2,stars:2,xp:50,check:s=>s.totalDistance>=10000},
 {id:'total_50k',icon:'🗺️',name:'Покоритель дорог',desc:'Набери 50 000 м суммарно',tier:3,stars:4,xp:120,check:s=>s.totalDistance>=50000},
 {id:'total_100k',icon:'🌍',name:'Вокруг света',desc:'Набери 100 000 м суммарно',tier:4,stars:6,xp:250,check:s=>s.totalDistance>=100000},
 {id:'total_500k',icon:'🪐',name:'Космический пробег',desc:'Набери 500 000 м суммарно',tier:5,stars:10,xp:650,check:s=>s.totalDistance>=500000},
 {id:'hard_1k',icon:'☠️',name:'Проверка характера',desc:'Проедь 1 000 м в Хардкоре',tier:3,stars:5,xp:100,check:(s,r)=>r.mode===2&&r.distance>=1000},
 {id:'hard_3k',icon:'🔥',name:'Стальной характер',desc:'Проедь 2 000 м в Хардкоре',tier:4,stars:9,xp:300,check:(s,r)=>s.modeBest[2]>=2000},
 {id:'night_1k',icon:'🌑',name:'Ночная смена',desc:'Проедь 1 000 м в Кошмаре',tier:3,stars:6,xp:150,check:(s,r)=>r.mode===3&&r.distance>=1000},
 {id:'night_3k',icon:'👁️',name:'Не смотри назад',desc:'Проедь 2 000 м в Кошмаре',tier:5,stars:10,xp:400,check:(s,r)=>s.modeBest[3]>=2000},
 {id:'all_modes',icon:'🎭',name:'Универсал',desc:'Сыграй хотя бы по разу во всех режимах',tier:3,stars:4,xp:100,check:s=>s.modeRuns.every(n=>n>0)},
 {id:'hard_all',icon:'💀',name:'Любитель испытаний',desc:'Сыграй 20 раз на сложности «Сложно»',tier:4,stars:7,xp:300,check:s=>s.diffRuns[2]>=20},
 {id:'quest_25',icon:'📜',name:'Исполнитель',desc:'Выполни 25 заданий',tier:3,stars:5,xp:150,check:s=>s.questsCompleted>=25},
 {id:'quest_100',icon:'📚',name:'Мастер поручений',desc:'Выполни 100 заданий',tier:5,stars:9,xp:650,check:s=>s.questsCompleted>=100},
];
function rawMetric(metric,mode){const s=cfg.stats||initStats();if(metric==='modeRuns')return s.modeRuns[clamp(mode|0,0,3)]||0;if(metric==='diffRuns')return s.diffRuns[clamp(mode|0,0,2)]||0;return Number(s[metric])||0;}
function genTask(id,title,desc,metric,target,rewardType,reward,difficulty,mode,stars){return {id,title,desc,metric,target,rewardType,reward,difficulty,stars:clamp(Number(stars)||3,1,10),mode:mode??-1,startValue:metric==='lastRun'?0:rawMetric(metric,mode),progress:0,done:false};}
function generateDaily(){
 const rng=seeded(todayKey()+'|'+(cfg.pn||'guest')+'|daily');
 const dist=5000+Math.floor(rng()*3)*1000,runs=8,best=1800+Math.floor(rng()*3)*200;
 return [
  genTask('daily_dist_'+todayKey(),'Набрать дистанцию','Набери суммарно '+dist.toLocaleString('ru-RU')+' м','totalDistance',dist,'xp',35,'Среднее',-1,5),
  genTask('daily_runs_'+todayKey(),'Не сбавляй темп','Заверши '+runs+' забегов','runs',runs,'coins',30,'Среднее',-1,5),
  genTask('daily_best_'+todayKey(),'Дальний заезд','Проедь '+best.toLocaleString('ru-RU')+' м за один забег','lastRun',best,'xp',45,'Сложное',-1,6)
 ];
}
function generateRegular(count){
 const rng=seeded(weekKey()+'|'+(cfg.pn||'guest')+'|'+(cfg.questData?.serial||0));
 const out=[],modes=[0,1,2,3];
 for(let i=0;i<count;i++){
  const kind=i%6,mode=modes[Math.floor(rng()*4)],hard=Math.floor(rng()*3);let q;
  if(kind===0){const target=20000+Math.floor(rng()*3)*5000;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Большой пробег','Набери '+target.toLocaleString('ru-RU')+' м суммарно','totalDistance',target,'xp',target>=30000?65:45,'Сложное',-1,7);}
  else if(kind===1){const target=12;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Опытный водитель','Заверши '+target+' забегов','runs',target,'coins',45,'Сложное',-1,6);}
  else if(kind===2){const target=3500+Math.floor(rng()*3)*500;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Планка дальности','Проедь '+target.toLocaleString('ru-RU')+' м за один забег','lastRun',target,'xp',target>=4500?80:70,'Очень сложное',-1,8);}
  else if(kind===3){const target=8;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Режимная работа','Сыграй '+target+' раз: '+MODES[mode],'modeRuns',target,'coins',55,'Сложное',mode,7);}
  else if(kind===4){const target=8;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Сложная полоса','Сыграй '+target+' раз на сложности «'+DIFFS[hard]+'»','diffRuns',target,'xp',60,'Сложное',hard,7);}
  else {const target=4500+Math.floor(rng()*3)*500;q=genTask('reg_'+weekKey()+'_'+i+'_'+Math.floor(rng()*99999),'Рекордный заезд','Проедь '+target.toLocaleString('ru-RU')+' м за один забег','lastRun',target,'coins',80,'Очень сложное',-1,8);}
  out.push(q);
 }
 return out;
}
function getMetric(task){const raw=rawMetric(task.metric,task.mode);return task.metric==='lastRun'?raw:Math.max(0,raw-(Number(task.startValue)||0));}
function progressTasks(){const q=cfg.questData;let xp=0,coins=0,bonusXP=0,bonusCoins=0,done=[];
 const update=(task,isRegular,index)=>{const current=getMetric(task);task.progress=task.metric==='lastRun'?Math.max(Number(task.progress)||0,current):current;if(task.done||task.progress<task.target)return;task.done=true;cfg.stats.questsCompleted++;const reward=Math.max(0,Math.floor(Number(task.reward)||0));if(task.rewardType==='coins'){coins+=reward;bonusXP+=reward;}else{xp+=reward;bonusCoins+=reward;}done.push(task.title);if(isRegular)task.nextAt=Date.now()+6*60*60*1000;};
 (q.daily||[]).forEach(t=>update(t,false,0));(q.regular||[]).forEach((t,i)=>update(t,true,i));
 const totalCoins=coins+bonusCoins;if(totalCoins)cfg.c=(Number(cfg.c)||0)+totalCoins;
 return {xp:xp+bonusXP,baseXP:xp,bonusXP,coins:totalCoins,baseCoins:coins,bonusCoins,done};
}
function generateReplacement(index){
 const q=cfg.questData;q.serial=(Number(q.serial)||0)+1;const base=generateRegular(10);const used=new Set((q.regular||[]).map(x=>x?.id));return base.find(x=>!used.has(x.id))||base[index%base.length];
}
function awardAchievements(run){let xp=0,coins=0,unlocked=[];for(const a of achievementList){if(cfg.ach.includes(a.id))continue;let ok=false;try{ok=!!a.check(cfg.stats,run)}catch(_){ }if(ok){cfg.ach.push(a.id);xp+=a.xp;coins+=a.xp;cfg.c=(Number(cfg.c)||0)+a.xp;unlocked.push(a);}}
 if(unlocked.length)cfg.ach=Array.from(new Set(cfg.ach));return {xp,coins,unlocked};}
function awardHuntAchievements(){return {xp:0,levelCoins:0,unlocked:[]};}
async function refreshTasksFromCloud(){
 const api=window.BobikCloudApi;if(!api?.isAuthenticated?.())return;
 try{const state=await api.getState();if(state?.questData&&typeof state.questData==='object'){cfg.questData=state.questData;ensureState();save();if(rewardTab==='tasks'&&!E('rewards').classList.contains('hide'))renderRewards();}}
 catch(err){console.warn('Quest state refresh failed:',err.message);const box=E('rewardContent');if(box&&rewardTab==='tasks')box.insertAdjacentHTML('afterbegin','<p class="reward-muted">Не удалось обновить задания: '+escapeHtml(err.message||'ошибка')+'</p>');}
}
function hardestAchievements(ids,count=3){return achievementList.filter(a=>ids.includes(a.id)).sort((a,b)=>b.tier-a.tier||b.xp-a.xp).slice(0,count);}
function syncCloud(){save();try{window.BobikCloudApi?.syncProgress?.(cfg.xp,cfg.ach)?.catch?.(e=>console.warn('Progress sync failed',e));}catch(e){console.warn('Progress sync failed',e);}}
function processRun(distance,mode,diff,baseCoins){
 ensureState();distance=Math.max(0,Math.floor(Number(distance)||0));mode=clamp(mode|0,0,3);diff=clamp(diff|0,0,2);
 const stats=cfg.stats;stats.runs++;stats.totalDistance+=distance;stats.lastRun=distance;stats.bestRun=Math.max(stats.bestRun,distance);stats.modeRuns[mode]++;stats.modeBest[mode]=Math.max(stats.modeBest[mode],distance);stats.diffRuns[diff]++;
 cfg.runHistory.push({mode,difficulty:diff,distance,created_at:new Date().toISOString()});cfg.runHistory=cfg.runHistory.slice(-500);
 const oldLevel=getLevel(cfg.xp),distanceScore=Math.floor(distance/10*[.9,1,1.15][diff]*[1,1.05,1.12,1.2][mode]);
 const bonusCoins=Math.floor(distanceScore*(.08+Math.min(1000,oldLevel)*.00016));cfg.c=(Number(cfg.c)||0)+bonusCoins;
 const missions=progressTasks();const achievements=awardAchievements({mode,difficulty:diff,distance});
 const base=Math.max(0,Math.floor(Number(baseCoins)||0)),roundCoins=base+bonusCoins+missions.coins;
 const coinXP=Math.floor(roundCoins*1.5),xpRun=0,totalXP=coinXP+missions.xp+achievements.xp;
 const xpResult=addXP(totalXP),xpTotal=xpResult.gained,levelCoins=xpResult.levelCoins;
 cfg.level=getLevel(cfg.xp);cfg.lastRunXP=xpTotal;cfg.lastRunDate=Date.now();
 try{window.BobikCloudApi?.recordRun?.(mode,diff,distance)?.catch?.(e=>console.warn('Run history sync failed',e));}catch(e){console.warn('Run history sync failed',e);}
 syncCloud();renderMenuProgress();if(E('profileLevel')&&!E('prof').classList.contains('hide'))renderOwnProfile();
 if(achievements.unlocked.length)toast('🏅 Новое достижение: '+achievements.unlocked[0].name);
 if(missions.done.length)toast('📋 Выполнено заданий: '+missions.done.length);
 const earned=roundCoins+achievements.coins+levelCoins;
 return {earned,baseCoins:base,bonusCoins,coinXP,xp:xpTotal,runXP:xpRun,missionXP:missions.xp,achievementXP:achievements.xp,levelCoins,missionCoins:missions.coins,achievementCoins:achievements.coins,level:cfg.level,levels:Math.max(0,cfg.level-oldLevel),unlocked:achievements.unlocked,completed:missions.done,info:levelInfo(cfg.xp)};
}
function attemptHunt(distance,result,mode){
 const hunt=cfg.runHunts?.global||cfg.activeHunt;cfg.runHunts=null;
 if(!hunt?.id||distance<(Number(hunt.target_distance)||Infinity))return;
 if(window.BobikCloudApi?.isAuthenticated?.())return; // Online completion and reward are handled atomically by Supabase.
 toast('🌍 Глобальное задание доступно после подключения к аккаунту.');
}
function setActiveHunt(row){if(!row)return;const value={id:row.hunt_id||row.id||'global',title:row.title||'БЕГИ',icon:row.icon||'👁️',objective:row.objective||'Проедь 3000 м в режиме Кошмара',sequence_index:Number(row.sequence_index)||1,target_distance:Number(row.target_distance)||3000,difficulty:Number(row.difficulty)||2,difficulty_stars:Number(row.difficulty_stars)||8,mode:Number(row.mode??3),hold_hours:Number(row.hold_hours)||5,is_completed:!!row.is_completed,created_at:row.created_at||null};cfg.activeHunt=value;cfg.activeHunts={global:value};delete cfg.activeNormalHunt;save();renderHunt();}
function setActiveHunts(rows){const list=Array.isArray(rows)?rows:[];const row=list.find(r=>Number(r.id)===1)||list[0];if(row)setActiveHunt(row);else{cfg.activeHunts={global:cfg.activeHunt};delete cfg.activeNormalHunt;save();}}
function renderMenuProgress(){const p=levelInfo(cfg.xp);const level=E('menuLevel');if(!level)return;level.textContent='⭐ УРОВЕНЬ '+p.level.toLocaleString('ru-RU');E('menuXpText').textContent=p.level===MAX_LEVEL?'МАКСИМАЛЬНЫЙ УРОВЕНЬ':p.into.toLocaleString('ru-RU')+' / '+p.needed.toLocaleString('ru-RU')+' XP';E('menuXpFill').style.width=p.percent+'%';E('menuXpPercent').textContent=p.level===MAX_LEVEL?'MAX':Math.floor(p.percent)+'%';if(E('vr'))E('vr').innerHTML='v1.9.3<br>⭐ Ур. '+p.level+' · 🪙 '+Math.floor(cfg.c||0)+' · 🏆 '+Math.max(...(cfg.r||[0]))+' м';}
function rewardTabs(active){return '<div class="reward-tabs"><button data-rt="ach" class="'+(active==='ach'?'on':'')+'">🏅 Достижения</button><button data-rt="tasks" class="'+(active==='tasks'?'on':'')+'">📋 Задания</button><button data-rt="hunt" class="'+(active==='hunt'?'on':'')+'">🌍 Охота</button></div>';}
let rewardTab='ach',huntSubtab='about';
function renderAchievements(){const unlocked=new Set(cfg.ach);const list=achievementList.map(a=>{const got=unlocked.has(a.id);return '<article class="achievement-card '+(got?'unlocked':'locked')+' tier-'+a.tier+'"><div class="achievement-icon">'+a.icon+'</div><div class="achievement-info"><b>'+escapeHtml(a.name)+'</b><span>'+escapeHtml(a.desc)+'</span>'+starRating(a.stars)+'<small>'+(got?'Получено':'Заблокировано')+' · +'+a.xp.toLocaleString('ru-RU')+' XP · +'+a.xp.toLocaleString('ru-RU')+' монет</small></div><i class="achievement-state">'+(got?'✓':'🔒')+'</i></article>';}).join('');return '<div class="rewards-summary"><b>Открыто: '+unlocked.size+' / '+achievementList.length+'</b><span>За каждое достижение начисляются XP и равный монетный бонус</span></div><div class="achievement-list">'+list+'</div>'; }
function starRating(value){const n=clamp(Math.round(Number(value)||1),1,10);return '<span class="difficulty-stars" aria-label="Сложность '+n+' из 10">'+('★'.repeat(n))+('<span class="star-empty">'+('☆'.repeat(10-n))+'</span>')+'</span>'; }
function taskCard(t){const pct=clamp(t.progress/Math.max(1,t.target)*100,0,100),stars=t.stars||1,reward=Math.max(0,Number(t.reward)||0),xp=t.rewardType==='xp'?reward:reward,coins=t.rewardType==='coins'?reward:reward,ready=t.nextAt?new Date(t.nextAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';return '<article class="quest-card '+(t.done?'done':'')+'"><div class="quest-top"><b>'+escapeHtml(t.title)+'</b>'+starRating(stars)+'</div><p>'+escapeHtml(t.desc)+'</p><div class="quest-progress"><i style="width:'+pct+'%"></i></div><div class="quest-bottom"><span>'+Math.floor(t.progress).toLocaleString('ru-RU')+' / '+t.target.toLocaleString('ru-RU')+'</span><b>⭐ +'+xp.toLocaleString('ru-RU')+' XP · 🪙 +'+coins.toLocaleString('ru-RU')+' монет</b></div>'+(t.done?'<small class="quest-done">✓ Выполнено · '+(ready?'Новое задание после '+ready:'Новое задание через 6 часов')+'</small>':'')+'</article>'; }
function renderTasks(){const q=cfg.questData;return '<div class="quest-section"><h3>☀️ Ежедневные задания <small>Обновляются каждый день</small></h3>'+q.daily.map(taskCard).join('')+'</div><div class="quest-section"><h3>🧩 Дополнительные задания <small>10 активных · новые появляются после выполнения</small></h3>'+q.regular.map(taskCard).join('')+'</div>';}
async function renderHuntLeaderboard(){
 const box=E('huntContent');if(!box)return;box.innerHTML='<p class="reward-muted">Загружаю таблицу глобального задания…</p>';
 const api=window.BobikCloudApi;
 try{
  if(api?.isAuthenticated?.())await api.refreshHunt();
  const hunt=cfg.activeHunts?.global||cfg.activeHunt;
  if(!api?.isAuthenticated?.())throw new Error('Войди в аккаунт, чтобы загрузить таблицу охотников.');
  if(!hunt?.id)throw new Error('Сервер не вернул активное глобальное задание.');
  const [rows,history]=await Promise.all([api.huntProgress(hunt.id),api.huntCompletions()]);
  if(!Array.isArray(rows)||!Array.isArray(history))throw new Error('Сервер не вернул таблицу прогресса.');
  const final=Number(hunt.sequence_index)===5;
  const finalAward=rows.find(r=>r.completed&&(Number(r.reward_xp)>0||Number(r.reward_coins)>0));
  let rewardNotice='';
  if(finalAward){
   const rxp=Math.max(0,Number(finalAward.reward_xp)||0),rcoins=Math.max(0,Number(finalAward.reward_coins)||0);
   rewardNotice='<div class="hunt-reward-current">🏆 <b>Финальная охота завершена!</b><br>Начислено: +'+rxp.toLocaleString('ru-RU')+' XP · +'+rcoins.toLocaleString('ru-RU')+' монет</div>';
   try{const state=await api.getState();if(state?.economy)cfg.c=Number(state.economy.coins)||0;if(state?.progress){cfg.xp=Number(state.progress.xp)||0;cfg.level=Number(state.progress.level)||1;cfg.ach=state.progress.achievements||[];}if(state?.hunt)setActiveHunt(state.hunt);save();renderMenuProgress();}catch(refreshError){console.warn('Final hunt reward state refresh failed:',refreshError.message);}
   toast('🏆 Финальная охота: +'+rxp.toLocaleString('ru-RU')+' XP и +'+rcoins.toLocaleString('ru-RU')+' монет');
  }
  const progress=rows.length?'<section class="hunt-progress-section"><h3>🌍 Прогресс: '+escapeHtml(hunt.title||'Глобальное задание')+'</h3>'+rows.map((r,i)=>{
   const pct=Math.max(0,Math.min(100,Number(r.progress_percent)||0));
   const modeName=['Обычный','Три жизни','Хардкор','Кошмар'][Number(r.mode)]||'Все режимы';
   const hold=Number(r.hold_seconds)||0;
   const score=final?'Все 10 категорий · '+Math.floor(hold/3600)+' ч '+Math.floor((hold%3600)/60)+' мин из '+Number(hunt.hold_hours||5)+' ч':Number(r.best_distance||0).toLocaleString('ru-RU')+' / '+Number(hunt.target_distance||0).toLocaleString('ru-RU')+' м';
   return '<div class="hunt-progress-row hunt-player-row" '+(r.user_id?'data-pu="'+escapeHtml(r.user_id)+'"':'')+'><div class="hunt-progress-top"><b>'+escapeHtml(r.display_name||'Игрок')+'</b><strong>'+pct.toFixed(0)+'% '+(r.completed?'✓':'')+'</strong></div><div class="quest-progress"><i style="width:'+pct+'%"></i></div><small>'+escapeHtml(score)+' · '+Number(r.attempts||0).toLocaleString('ru-RU')+' забегов'+(r.completed?' · Выполнено':'')+'</small></div>';
  }).join('')+'</section>':'<p class="reward-muted">Пока нет прогресса по этому заданию.</p>';
  const winners=history.length?'<section class="hunt-progress-section"><h3>🏆 Выполнили глобальные задания</h3>'+history.slice(0,30).map((r,i)=>'<div class="leader-row hunt-player-row" '+(r.user_id?'data-pu="'+escapeHtml(r.user_id)+'"':'')+'><b>'+(i+1)+'. '+escapeHtml(r.display_name||'Игрок')+'</b><span><b class="hunt-percent">'+Number(r.completion_percent||0).toFixed(0)+'%</b> · '+Number(r.actual_distance||0).toLocaleString('ru-RU')+' м</span></div>').join('')+'</section>':'<p class="reward-muted">Пока никто не выполнил глобальное задание.</p>';
  box.innerHTML=progress+rewardNotice+winners;
 }catch(e){box.innerHTML='<p class="reward-muted">Не удалось загрузить прогресс охоты: '+escapeHtml(e.message||'ошибка')+'</p><button class="b news-retry" id="huntRetry">Повторить</button>';const retry=E('huntRetry');if(retry)retry.onclick=renderHuntLeaderboard;}
}
function renderHunt(){
 const box=E('huntAbout');if(!box)return;
 const h=cfg.activeHunts?.global||cfg.activeHunt||{title:'Кошмарный забег',icon:'🌑',objective:'Проедь 3 000 м в режиме «Кошмар»',target_distance:3000,mode:3,difficulty_stars:9,sequence_index:1,hold_hours:5};
 const seq=Number(h.sequence_index)||1,final=seq===5,done=!!h.is_completed,modeName=['Обычный режим','Режим три жизни','Режим хардкор','Режим кошмара'][Number(h.mode)]||'Все режимы';
 const steps=[['Кошмарный забег','3 000 м · Кошмар',5000,2000],['Испытание хардкора','5 000 м · Хардкор',5000,2000],['Большая дистанция','10 000 м · Обычный',5000,2000],['Три жизни','6 000 м · Три жизни',5000,2000],['Абсолютный чемпион','Топ-1 во всех 10 категориях · 5 часов',5000,2000]];
 const stepList='<div class="hunt-sequence-list">'+steps.map((x,i)=>'<div class="hunt-sequence-step '+(done||i<seq-1?'done':i===seq-1?'active':'locked')+'"><b>'+(done||i<seq-1?'✓':i+1+'.')+' '+x[0]+'</b><small>'+x[1]+'</small><small class="hunt-step-reward">🎁 Награда: +'+x[2].toLocaleString('ru-RU')+' XP · +'+x[3].toLocaleString('ru-RU')+' монет</small></div>').join('')+'</div>';
 const currentReward=steps[Math.max(0,Math.min(4,seq-1))];
 box.innerHTML='<div class="hunt-hero"><div class="hunt-globe">'+escapeHtml(h.icon||'🌍')+'</div><span class="hunt-kicker">ЕДИНОЕ ГЛОБАЛЬНОЕ ЗАДАНИЕ · '+(done?'5/5':seq+'/5')+'</span><h3>'+escapeHtml(h.title||'Глобальное задание')+'</h3><b class="hunt-target">'+(done?'✓ <small>СЕРИЯ ЗАВЕРШЕНА</small>':final?'5 <small>ЧАСОВ</small>':Number(h.target_distance||0).toLocaleString('ru-RU')+' <small>МЕТРОВ</small>')+'</b><p>'+escapeHtml(h.objective||'Выполни условие в указанном режиме.')+'</p><div class="hunt-reward-current">🎁 Награда за текущее задание: <b>+'+currentReward[2].toLocaleString('ru-RU')+' XP</b> и <b>+'+currentReward[3].toLocaleString('ru-RU')+' монет</b></div><div class="hunt-meta"><span>'+(final?'Все 10 категорий таблицы лидеров':modeName)+'</span><span>'+(final?'Нужно удерживать 5 часов':'Следующее задание откроется всем после выполнения')+'</span></div></div>'+stepList+'<p class="hunt-note">'+(done?'Все пять глобальных заданий выполнены.':'Задания проходят строго по порядку. Текущая цель общая для всех игроков.')+'</p>';
}
function renderRewards(){ensureState();const nav=E('rewardNav'),content=E('rewardContent');if(!nav||!content)throw new Error('Не найдены контейнеры наград');nav.innerHTML=rewardTabs(rewardTab);content.innerHTML=rewardTab==='ach'?renderAchievements():rewardTab==='tasks'?renderTasks():'<div class="hunt-subtabs"><button data-hunt-tab="about" class="'+(huntSubtab==='about'?'on':'')+'">Текущая охота</button><button data-hunt-tab="board" class="'+(huntSubtab==='board'?'on':'')+'">🏆 Таблица охотников</button></div><div id="huntAbout" class="hunt-content '+(huntSubtab==='about'?'':'hide')+'"></div><div id="huntContent" class="hunt-content '+(huntSubtab==='board'?'':'hide')+'"></div>';
 if(rewardTab==='hunt'){
  renderHunt();
  const api=window.BobikCloudApi;
  if(api?.isAuthenticated?.())api.refreshHunt().then(()=>{if(rewardTab==='hunt'){renderHunt();if(huntSubtab==='board')renderHuntLeaderboard();}}).catch(err=>console.warn('Global hunt refresh failed:',err.message));
  else if(huntSubtab==='board')renderHuntLeaderboard();
 }
}
function showRewards(tab){rewardTab=tab||'ach';if(!E('rewards'))initRewardsMarkup();show('rewards');try{renderRewards()}catch(err){console.error('Rewards rendering failed:',err);const box=E('rewardContent');if(box)box.innerHTML='<p class="reward-muted">Не удалось отобразить награды: '+String(err.message||err)+'</p>';}if(rewardTab==='hunt'){try{window.BobikCloudApi?.refreshHunt?.().then(()=>{if(!E('rewards').classList.contains('hide')&&rewardTab==='hunt')renderRewards();}).catch(()=>{});}catch(_){}}}
function bestLocalRuns(mode,diff){const rows=cfg.runHistory.filter(r=>Number(r.mode)===mode&&Number(r.difficulty)===diff).slice();const legacyDiff=Number(cfg.lr?.[mode]?.[diff])||0,legacyMode=Number(cfg.r?.[mode])||0;if(legacyDiff>0&&!rows.some(r=>Number(r.distance)===legacyDiff))rows.push({distance:legacyDiff,created_at:null,legacy:true});if(diff===0&&legacyMode>0&&!rows.some(r=>Number(r.distance)===legacyMode))rows.push({distance:legacyMode,created_at:null,legacy:true,legacyMode:true});return rows.sort((a,b)=>Number(b.distance)-Number(a.distance)).slice(0,10);}
function recordSelector(prefix,mode,diff){const options=mode===3?'<button data-record-diff="2" data-prefix="'+prefix+'" class="on">Сложно</button>':DIFFS.map((n,i)=>'<button data-record-diff="'+i+'" data-prefix="'+prefix+'" class="'+(i===diff?'on':'')+'">'+n+'</button>').join('');return '<div class="profile-record-selector"><div class="profile-mode-switch"><button data-record-step="-1" data-prefix="'+prefix+'">‹</button><b id="'+prefix+'Mode">'+MODES[mode]+'</b><button data-record-step="1" data-prefix="'+prefix+'">›</button></div><div class="profile-diff-tabs">'+options+'</div></div>';}
let ownMode=0,ownDiff=1,pubMode=0,pubDiff=1,publicProfileId=null;
function achievementBadges(ids){const top=hardestAchievements(ids,3);return top.length?'<div class="profile-achievements">'+top.map(a=>'<div class="profile-achievement" title="'+escapeHtml(a.name)+'"><span>'+a.icon+'</span><b>'+escapeHtml(a.name)+'</b></div>').join('')+'</div>':'<p class="reward-muted">Пока нет открытых достижений.</p>';}
function levelCard(info){if(!info)return '<div class="profile-level"><b>⭐ Уровень не загружен</b></div>';const p=levelInfo(Number(info.xp)||0);return '<div class="profile-level"><div><b>⭐ УРОВЕНЬ '+p.level.toLocaleString('ru-RU')+'</b><span>'+Number(info.xp||0).toLocaleString('ru-RU')+' XP</span></div><div class="level-bar"><i style="width:'+p.percent+'%"></i></div><small>'+(p.level===MAX_LEVEL?'Достигнут максимум':(p.next-Number(info.xp||0)).toLocaleString('ru-RU')+' XP до следующего уровня')+'</small></div>';}
function recordList(rows){return rows.length?'<div class="profile-run-list">'+rows.map((r,i)=>'<div class="profile-run"><b>'+(i+1)+'. '+Number(r.distance).toLocaleString('ru-RU')+' м</b><span>'+(r.legacy?(r.legacyMode?'Старый рекорд режима (сложность не сохранена)':'Сохранено из прошлой версии'):new Date(r.created_at||Date.now()).toLocaleDateString('ru-RU'))+'</span></div>').join('')+'</div>':'<p class="reward-muted">Для этого режима и сложности пока нет забегов.</p>';}
async function renderOwnRuns(){
 const box=E('ownRunRows');if(!box)return;box.innerHTML='<p class="reward-muted">Загрузка рекордов…</p>';
 let rows=bestLocalRuns(ownMode,ownDiff);
 try{const cloudRows=await window.BobikCloudApi?.getRuns?.(ownMode,ownDiff);if(Array.isArray(cloudRows)){const merged=[...cloudRows,...rows.filter(r=>r.legacy)];const seen=new Set();rows=merged.filter(r=>{const k=String(r.distance)+'|'+String(r.created_at||'legacy');if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>Number(b.distance)-Number(a.distance)).slice(0,10);}}
 catch(e){box.innerHTML='<p class="reward-muted">Не удалось загрузить облачные рекорды: '+escapeHtml(e.message||'ошибка')+'</p>';return;}
 box.innerHTML=recordList(rows);
}
async function renderOwnProfile(){
 initProfileMarkup();ensureState();
 try{
  if(window.BobikCloudApi?.isAuthenticated?.()){
   const state=await window.BobikCloudApi.getState();
   if(state?.progress){cfg.xp=Number(state.progress.xp)||0;cfg.level=Number(state.progress.level)||getLevel(cfg.xp);cfg.ach=Array.isArray(state.progress.achievements)?state.progress.achievements:cfg.ach;}
   if(state?.stats)cfg.stats={...cfg.stats,...state.stats,modeRuns:state.stats.modeRuns||cfg.stats.modeRuns,modeBest:state.stats.modeBest||cfg.stats.modeBest,diffRuns:state.stats.diffRuns||cfg.stats.diffRuns};
   if(Array.isArray(state?.runHistory))cfg.runHistory=state.runHistory;
   if(state?.r)cfg.r=state.r;if(state?.lr)cfg.lr=state.lr;
  }
 }catch(e){console.warn('Profile cloud refresh failed:',e.message);}
 const info=levelInfo(cfg.xp),levelBox=E('profileLevel'),achBox=E('profileAch'),titleBox=E('ownRecordsTitle'),selector=E('ownRunSelector');if(levelBox)levelBox.innerHTML=levelCard({xp:cfg.xp});if(achBox)achBox.innerHTML=achievementBadges(cfg.ach);if(titleBox)titleBox.textContent=MODES[ownMode]+' · '+DIFFS[ownDiff];if(selector)selector.innerHTML=recordSelector('own',ownMode,ownDiff);await renderOwnRuns();window.BobikProfileFavorites?.renderOwnProfile?.();renderMenuProgress();
}
async function renderPublicProfile(uid,profile){initProfileMarkup();publicProfileId=uid;const levelBox=E('publicLevel'),achBox=E('publicAch'),rowsBox=E('publicRunRows');if(levelBox)levelBox.innerHTML='<p class="reward-muted">Загружаю уровень…</p>';if(achBox)achBox.innerHTML='';if(rowsBox)rowsBox.innerHTML='<p class="reward-muted">Загружаю рекорды…</p>';
 try{const prog=await window.BobikCloudApi?.getProgress?.(uid);if(levelBox)levelBox.innerHTML=prog?levelCard(prog):'<p class="reward-muted">Уровень ещё не синхронизирован.</p>';if(achBox)achBox.innerHTML=achievementBadges(prog?.achievements||[]);}catch(_){if(levelBox)levelBox.innerHTML='<p class="reward-muted">Не удалось загрузить уровень.</p>';if(achBox)achBox.innerHTML='<p class="reward-muted">Не удалось загрузить достижения.</p>'; }
 window.BobikProfileFavorites?.renderPublicProfile?.(profile||{});renderPublicRuns();
}
async function renderPublicRuns(){const box=E('publicRunRows');if(!box||!publicProfileId)return;box.innerHTML='<p class="reward-muted">Загрузка рекордов…</p>';let rows=[];try{rows=await window.BobikCloudApi?.getRuns?.(pubMode,pubDiff,publicProfileId)||[];}catch(_){}box.innerHTML=recordList(rows);E('publicRecordsTitle').textContent=MODES[pubMode]+' · '+DIFFS[pubDiff];E('publicRunSelector').innerHTML=recordSelector('pub',pubMode,pubDiff);}
function initProfileMarkup(){
 const profile=E('prof');
 if(profile&&!E('profileLevel')){
  const markup='<section class="profile-progression"><h3>⭐ Прогресс уровня</h3><div id="profileLevel"></div><h3>💎 Любимые модели</h3><div id="favoriteOwnControls"></div><div id="favoriteOwnPreview" class="favorite-preview-grid"></div><h3>🏅 Три самых сложных достижения</h3><div id="profileAch"></div><h3>🏁 Таблица личных рекордов</h3><p id="ownRecordsTitle" class="reward-muted">Выбери режим и сложность.</p><div id="ownRunSelector"></div><div id="ownRunRows"></div></section>';
  const sec=profile.querySelector('.account-security');if(sec)sec.insertAdjacentHTML('beforebegin',markup);else profile.insertAdjacentHTML('beforeend',markup);
 }
 const pub=E('pubp');
 if(pub&&!E('publicLevel')){
  const markup='<section class="profile-progression public-progression"><h3>⭐ Уровень</h3><div id="publicLevel"></div><h3>💎 Любимые модели</h3><div id="favoritePublicPreview" class="favorite-preview-grid"></div><h3>🏅 Лучшие достижения</h3><div id="publicAch"></div><h3>🏁 Лучшие забеги</h3><p id="publicRecordsTitle" class="reward-muted"></p><div id="publicRunSelector"></div><div id="publicRunRows"></div></section>';
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
  const rt=e.target.closest('[data-rt]');if(rt){rewardTab=rt.dataset.rt;renderRewards();if(rewardTab==='tasks')refreshTasksFromCloud();return;}
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
window.BobikProgress={processRun,refreshTasksFromCloud,onRunStart(){cfg.runHunts={global:{...(cfg.activeHunts?.global||cfg.activeHunt||{})}};},setActiveHunt,showRewards,renderRewards,renderMenuProgress,renderOwnProfile,renderPublicProfile,renderPublicRuns,getLevelInfo:()=>levelInfo(cfg.xp),hardestAchievements,achievementList};
try{
 init();
 window.BobikProgressReady=true;
}catch(initError){
 window.BobikProgressReady=false;
 console.error('Bobik progression initialization failed:',initError);
 const box=E('rewardContent');if(box)box.innerHTML='<p class="reward-muted">Ошибка загрузки наград: '+String(initError.message||initError)+'</p>';
}
})();
