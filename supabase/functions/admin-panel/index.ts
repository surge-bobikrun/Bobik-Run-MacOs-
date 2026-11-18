import { createClient } from "npm:@supabase/supabase-js@2";
const OWNER_ID = "c517c2c5-60bc-4ba3-9670-49df6fa3602e";
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}})}
function readKeySet(name:string):Record<string,string>{try{return JSON.parse(Deno.env.get(name)??"{}")}catch{return {}}}
async function readJsonLimited(req:Request,maxBytes:number):Promise<Record<string,unknown>|null>{
 const declared=Number(req.headers.get("content-length")??0);
 if(Number.isFinite(declared)&&declared>maxBytes)throw new Error("BODY_TOO_LARGE");
 if(!req.body)return null;
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("BODY_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const parsed:unknown=JSON.parse(new TextDecoder().decode(bytes));
 return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),publishable=readKeySet("SUPABASE_PUBLISHABLE_KEYS").default??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??Deno.env.get("SUPABASE_ANON_KEY"),secret=readKeySet("SUPABASE_SECRET_KEYS").default??Deno.env.get("SUPABASE_SECRET_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!publishable||!secret)return json({error:"Supabase secrets are not configured"},500);
  const authHeader=req.headers.get("Authorization")??"";
  if(!authHeader.startsWith("Bearer ")||authHeader.length>8192)return json({error:"Authentication required"},401);
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:authHeader}},auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  const {data:userData,error:userError}=await userClient.auth.getUser();const user=userData?.user;
  if(userError||!user)return json({error:"Invalid session"},401);
  if(user.id!==OWNER_ID)return json({error:"Нет доступа к админ-панели"},403);
  const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  let body:Record<string,unknown>|null=null;
  try{body=await readJsonLimited(req,16*1024);}catch(error){const reason=String((error as Error)?.message||"");return json({error:reason==="BODY_TOO_LARGE"?"Request too large":"Invalid JSON body"},reason==="BODY_TOO_LARGE"?413:400);}
  const action=String(body?.action??"");
  if(action==="dashboard"){
   const [dashResult,auditResult,feedResult]=await Promise.all([
    admin.rpc("bobik_admin_dashboard_stats"),
    admin.from("admin_action_audit").select("actor_username,target_id,action,details,created_at").order("created_at",{ascending:false}).limit(12),
    admin.from("game_live_state").select("username,is_running,mode,distance_m,speed_kmh,seen_at").eq("is_running",true).order("seen_at",{ascending:false}).limit(10)
   ]);
   if(dashResult.error)throw dashResult.error;
   const audit=auditResult.error?[]:(auditResult.data??[]);
   const liveFeed=feedResult.error?[]:(feedResult.data??[]).filter((row:any)=>{const seen=Date.parse(row.seen_at);const age=Date.now()-seen;return Number.isFinite(seen)&&age>=0&&age<45000;});
   return json({...(dashResult.data??{total_players:0,online_count:0,total_runs:0,total_distance:0,best_run:0,top_players:[],hunts:[]}),recent_actions:audit,live_runs:liveFeed});
  }
  if(action==="search"){
   const query=String(body?.query??"").trim().normalize("NFKC").slice(0,32);if(query.length<2)return json({users:[],online_count:0});
   const pattern=`%${query.replace(/[\\%_]/g,"\\$&")}%`;
   const {data:profiles,error:pe}=await admin.from("profiles").select("id,username,created_at").ilike("username",pattern).order("created_at",{ascending:false}).limit(25);if(pe)throw pe;
   const ids=(profiles??[]).map((p:any)=>p.id);if(!ids.length)return json({users:[],online_count:0});
   const [presenceResult,authRows]=await Promise.all([
    admin.from("online_presence").select("user_id,last_seen").in("user_id",ids).gte("last_seen",new Date(Date.now()-90000).toISOString()),
    Promise.all(ids.map(async(id:string)=>{const {data,error}=await admin.auth.admin.getUserById(id);if(error)return null;return [id,data.user?.banned_until??null] as [string,string|null]}))
   ]);
   if(presenceResult.error)throw presenceResult.error;
   const online=new Set((presenceResult.data??[]).map((p:any)=>p.user_id));const banMap=new Map<string,string|null>(authRows.filter((x):x is [string,string|null]=>!!x));
   const users=(profiles??[]).map((p:any)=>{const until=banMap.get(p.id)??null;return{id:p.id,username:p.username||"Игрок",online:online.has(p.id),banned:!!until&&new Date(until).getTime()>Date.now(),banned_until:until,created_at:p.created_at}});
   return json({users,online_count:online.size});
  }
  if(action==="spectate"){
   const target=String(body?.user_id??"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target)||target===OWNER_ID)return json({error:"Некорректный аккаунт"},400);
   // v1.9.6: parallel telemetry + active control fetch for the live round view.
   const [stateResult,controlResult]=await Promise.all([
    admin.from("game_live_state").select("user_id,username,is_running,mode,difficulty,distance_m,speed_kmh,character_id,vehicle_id,lane_x,gap_ratio,lives,activity,live_frame,seen_at").eq("user_id",target).maybeSingle(),
    admin.from("game_player_controls").select("effect,is_active,expires_at").eq("user_id",target).maybeSingle()
   ]);
   if(stateResult.error)throw stateResult.error;if(controlResult.error)throw controlResult.error;
   const state=stateResult.data,control=controlResult.data;
   const modes=["Обычный","Три жизни","Хардкор","Кошмар"],characters=["Горилла","Прыщавый","Бобик","Девушка Прыщавого","Горилла на пропеллере","Пятнистая горилла","Бобик-горилла","Руслан","Волосатая горилла"],vehicles=["Цистерна","Горилла","Бобик","Банан"];
   const seenMs=state?.seen_at?Date.parse(state.seen_at):NaN;
   const ageMs=Date.now()-seenMs;
   const fresh=!!state&&Number.isFinite(seenMs)&&ageMs>=0&&ageMs<12000;
   const controlActive=!!(control?.is_active&&Date.parse(control.expires_at||"")>Date.now());
   return json({username:state?.username??"Игрок",is_running:!!(fresh&&state?.is_running),mode:state?.mode,mode_name:state?.mode==null?"—":modes[state.mode]??"—",difficulty:state?.difficulty,distance_m:state?.distance_m??0,speed_kmh:state?.speed_kmh??0,character_id:state?.character_id,vehicle_id:state?.vehicle_id,character_name:characters[state?.character_id??-1]??"—",vehicle_name:vehicles[state?.vehicle_id??-1]??"—",lane_x:state?.lane_x??null,gap_ratio:state?.gap_ratio??null,lives:state?.lives??null,activity:state?.activity??null,live_frame:state?.live_frame??null,active_control:controlActive?String(control.effect??"none"):"none",seen_at:state?.seen_at??null,stale:!fresh});
  }
  if(action==="set_control"){
   const target=String(body?.user_id??""),effect=String(body?.effect??"");
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target)||target===OWNER_ID)return json({error:"Некорректный аккаунт"},400);
   if(!["slow","boost","manual","bobik","clear"].includes(effect))return json({error:"Неизвестный эффект"},400);
   const duration=Math.min(300,Math.max(5,Math.round(Number(body?.duration_seconds)||30))),speed=Number(body?.speed_kmh);
   if(effect==="manual"&&(!Number.isInteger(speed)||speed<5||speed>250))return json({error:"Ручная скорость должна быть целым числом от 5 до 250 км/ч"},400);
   const forceBobik=effect==="bobik"||body?.force_bobik===true,multiplier=effect==="slow"?0.5:effect==="boost"?1.5:1,active=effect!=="clear";
   const label=effect==="slow"?"замедление":effect==="boost"?"ускорение":effect==="manual"?`скорость ${speed} км/ч`:effect==="bobik"?"замену персонажа и машины на Бобика":"сброс эффектов";
   const notice=`Администратор surge применил к вашему забегу: ${label}${forceBobik&&effect!=="bobik"?" и включил модели Бобика":""}.`;
   const expires=new Date(Date.now()+(active?duration*1000:0)).toISOString();
   const row={user_id:target,effect,is_active:active,speed_multiplier:multiplier,speed_override_kmh:effect==="manual"?speed:null,force_bobik:active&&forceBobik,actor_username:"surge",notice,expires_at:expires,updated_at:new Date().toISOString()};
   const {error}=await admin.from("game_player_controls").upsert(row,{onConflict:"user_id"});if(error)throw error;
   const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:target,action:"set_control",details:{effect,duration_seconds:duration,speed_kmh:effect==="manual"?speed:null,force_bobik:active&&forceBobik}});if(auditError)console.error("admin audit write failed:",auditError);
   return json({success:true,notice,expires_at:expires});
  }
  if(action==="grant_rewards"){
   const target=String(body?.user_id??""),coins=Number(body?.coins),xp=Number(body?.xp),reason=typeof body?.reason==="string"?body.reason.trim().slice(0,100):"Администраторская награда";
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target))return json({error:"Некорректный аккаунт"},400);
   if(!Number.isSafeInteger(coins)||coins<0||coins>100000000||!Number.isSafeInteger(xp)||xp<0||xp>24366487||(coins===0&&xp===0))return json({error:"Монеты: 0–100 000 000; XP: 0–24 366 487. Нужна хотя бы одна ненулевая награда."},400);
   const {data,error}=await admin.rpc("admin_grant_rewards",{p_user_id:target,p_coins:coins,p_xp:xp,p_actor_id:user.id,p_actor_username:"surge",p_reason:reason});if(error)throw error;
   const message=`Администратор surge выдал вам +${Number(data?.coins_awarded||0).toLocaleString("ru-RU")} монет и +${Number(data?.xp_awarded||0).toLocaleString("ru-RU")} XP. Причина: ${reason||"без комментария"}.`;
   const {error:noticeError}=await admin.from("admin_player_notices").insert({user_id:target,message});if(noticeError)console.error("admin player notice write failed:",noticeError);
   return json({...data,notice:message});
  }
  if(action==="news_create"){
   const title=typeof body?.title==="string"?body.title.trim():"",content=typeof body?.body==="string"?body.body.trim():"";
   if(title.length<1||title.length>90||content.length<1||content.length>1200)return json({error:"Заголовок: 1–90 символов, текст: 1–1200 символов"},400);
   const {data,error}=await admin.from("game_news").insert({title,body:content,created_by:user.id}).select("id").single();if(error)throw error;const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:null,action:"news_create",details:{news_id:data.id,title}});if(auditError)console.error("admin audit write failed:",auditError);return json({success:true});
  }
  if(action==="news_update"||action==="news_delete"){
   const id=typeof body?.id==="string"?body.id:String(body?.id??"");if(!/^[1-9]\d{0,18}$/.test(id)||BigInt(id)>9223372036854775807n)return json({error:"Некорректный идентификатор новости"},400);
   if(action==="news_update"){
    const title=typeof body?.title==="string"?body.title.trim():"",content=typeof body?.body==="string"?body.body.trim():"";if(title.length<1||title.length>90||content.length<1||content.length>1200)return json({error:"Заголовок: 1–90 символов, текст: 1–1200 символов"},400);
    const {data,error}=await admin.from("game_news").update({title,body:content}).eq("id",id).select("id").maybeSingle();if(error)throw error;if(!data)return json({error:"Новость не найдена"},404);const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:null,action:"news_update",details:{news_id:id,title}});if(auditError)console.error("admin audit write failed:",auditError);return json({success:true});
   }
   const {data,error}=await admin.from("game_news").delete().eq("id",id).select("id").maybeSingle();if(error)throw error;if(!data)return json({error:"Новость не найдена"},404);const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:null,action:"news_delete",details:{news_id:id}});if(auditError)console.error("admin audit write failed:",auditError);return json({success:true});
  }
  if(action==="broadcast"){
   const message=typeof body?.message==="string"?body.message.trim():"";if(message.length<1||message.length>240)return json({error:"Сообщение должно содержать от 1 до 240 символов"},400);
   const {data,error}=await admin.from("global_messages").insert({message,created_by:user.id}).select("id").single();if(error)throw error;const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:null,action:"broadcast",details:{message_id:data.id,message}});if(auditError)console.error("admin audit write failed:",auditError);return json({success:true});
  }
  if(action==="interrupt"){
   const target=typeof body?.user_id==="string"?body.user_id:"",message=typeof body?.message==="string"?body.message.trim():"";
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target))return json({error:"Некорректный аккаунт"},400);
   if(target===OWNER_ID)return json({error:"Нельзя прервать собственную игру"},400);if(!message||message.length>160)return json({error:"Подпись должна содержать 1–160 символов"},400);
   const {data,error}=await admin.from("game_interrupts").insert({user_id:target,message}).select("id").single();if(error)throw error;const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:target,action:"interrupt",details:{interrupt_id:data.id,message}});if(auditError)console.error("admin audit write failed:",auditError);return json({success:true});
  }
  if(action==="ban"||action==="unban"){
   const target=String(body?.user_id??"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target)||target===OWNER_ID)return json({error:"Некорректный аккаунт"},400);
   const hours=Math.min(876000,Math.max(1,Math.round(Number(body?.hours)||24)));const {error}=await admin.auth.admin.updateUserById(target,{ban_duration:action==="ban"?`${hours}h`:"none"});if(error)throw error;const {error:auditError}=await admin.from("admin_action_audit").insert({actor_id:user.id,actor_username:"surge",target_id:target,action,details:action==="ban"?{hours}:{}});if(auditError)console.error("admin audit write failed:",auditError);return json({success:true});
  }
  if(action==="coins")return json({error:"Выдача монет через старую команду отключена"},410);
  return json({error:"Unknown action"},400);
 }catch(error){console.error("admin-panel error:",error);return json({error:"Внутренняя ошибка админ-сервера"},500)}
});
