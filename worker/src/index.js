/** Cloudflare Worker: editare catalog GitHub Pages, protejat printr-o parolă de administrator.
 * Parola (secretul PAROLA) vine în antetul x-parola, peste HTTPS, și e comparată în timp constant.
 * Încercările eșuate sunt limitate pe IP în KV (binding LIMITE).
 * Tokenul GitHub stă în secretul GITHUB_TOKEN; niciun secret nu ajunge în browser.
 */
const ENCODER = new TextEncoder();
const MAX_INCERCARI = 12;
const FEREASTRA_MS = 5 * 60 * 1000;
const reply = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const bytesToBase64 = buf => {const bytes=new Uint8Array(buf);let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(out)};
const textToBase64 = s => bytesToBase64(ENCODER.encode(s));
const base64ToText = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g,'')),c=>c.charCodeAt(0)));
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};

/** Compară în timp constant. Nu scurtcircuităm la lungimi diferite, ca lungimea parolei să nu fie măsurabilă. */
function egal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const n=Math.max(a.length,b.length);let dif=a.length===b.length?0:1;for(let i=0;i<n;i++)dif|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return dif===0}

/* Limitarea încercărilor în KV: starea trebuie să fie comună tuturor izolatelor Worker-ului. */
async function esteBlocat(env,ip){if(!env.LIMITE)return false;const t=await env.LIMITE.get(`i:${ip}`,'json');if(!t||Date.now()-t.t>FEREASTRA_MS)return false;return t.n>=MAX_INCERCARI}
async function noteazaEsec(env,ip){if(!env.LIMITE)return;const cheie=`i:${ip}`;const acum=Date.now();const t=await env.LIMITE.get(cheie,'json');const activa=t&&acum-t.t<=FEREASTRA_MS;await env.LIMITE.put(cheie,JSON.stringify({t:activa?t.t:acum,n:activa?t.n+1:1}),{expirationTtl:600})}
async function reseteaza(env,ip){if(env.LIMITE)await env.LIMITE.delete(`i:${ip}`)}

async function verificaParola(request,env,ip){
 if(!env.PAROLA)fail(500,'Parola administratorului nu este configurată (secretul PAROLA).');
 if(await esteBlocat(env,ip))fail(429,'Prea multe încercări. Așteaptă câteva minute.');
 if(!egal(request.headers.get('x-parola'),env.PAROLA)){await noteazaEsec(env,ip);fail(401,'Parolă greșită.')}
 await reseteaza(env,ip);
}

function cors(request,env){const origin=request.headers.get('origin');const allowed=(env.SITE_ORIGIN||'').replace(/\/$/,'');if(origin&&origin===allowed)return {'access-control-allow-origin':origin,'access-control-allow-methods':'GET,PUT,POST,DELETE,OPTIONS','access-control-allow-headers':'content-type, x-parola','access-control-max-age':'600','vary':'Origin'};return {vary:'Origin'}}
function ghSettings(env){if(!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(env.GITHUB_REPO||'')||!env.GITHUB_TOKEN)fail(500,'GitHub nu este configurat.');return {repo:env.GITHUB_REPO,branch:env.GITHUB_BRANCH||'main',manifest:'docs/data/evidence.json'}}
async function github(env,route,{method='GET',body}={}){
 const {repo}=ghSettings(env);const r=await fetch(`https://api.github.com/repos/${repo}/${route}`,{method,headers:{'authorization':'Bearer '+env.GITHUB_TOKEN,'accept':'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'ase-dosar-cloudflare-worker','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!r.ok){let json={};try{json=await r.json()}catch{};if(r.status===409||r.status===422)fail(409,'Conflict de versiune sau modificare deja existentă. Reîncarcă datele.');fail(r.status===404?404:502,'Eroare GitHub ('+r.status+'): '+String(json.message||'operațiune eșuată').slice(0,200))}
 return r.json();
}
const ghPath=p=>p.split('/').map(encodeURIComponent).join('/');
async function getManifest(env){const s=ghSettings(env);const r=await github(env,`contents/${ghPath(s.manifest)}?ref=${encodeURIComponent(s.branch)}`);if(!r.content)fail(502,'Răspuns GitHub fără conținut.');return {manifest:JSON.parse(base64ToText(r.content)),sha:r.sha}}
const TYPES=['foto','video','document','link'], STATUSES=['published','review','draft'], CATEGORIES=['teren','presa','corespondenta','initiativa','altele'];
function validateManifest(m){if(!m||!Array.isArray(m.evidence)||m.evidence.length>10000)fail(400,'Format de date invalid.');const seen=new Set();for(const e of m.evidence){
 if(typeof e.id!=='string'||!/^[A-Za-z0-9-]{2,45}$/.test(e.id)||seen.has(e.id))fail(400,'Identificator invalid sau duplicat.');seen.add(e.id);
 if(typeof e.title!=='string'||e.title.length<3||e.title.length>250||typeof e.description!=='string'||e.description.length>8000)fail(400,'Titlu sau descriere invalidă.');
 if(!TYPES.includes(e.type)||!STATUSES.includes(e.status)||!CATEGORIES.includes(e.category))fail(400,'Tip, stare sau categorie invalidă.');
 if(e.date&&!/^\d{4}-\d{2}-\d{2}$/.test(e.date))fail(400,'Dată invalidă.');
 for(const key of ['path','thumbnail']){if(e[key]&&!/^media\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|mp4|webm|pdf|docx)$/.test(e[key]))fail(400,'Cale media invalidă: '+key)}
 if(e.url&&!/^https:\/\//i.test(e.url))fail(400,'URL extern invalid.');
 for(const k of ['source','location','filename','reviewNote'])if(e[k]&&String(e[k]).length>1000)fail(400,'Câmp prea lung: '+k);
 if(e.status==='published'&&!((e.type==='link'&&e.url)||(e.type!=='link'&&e.path)))fail(400,'Nu poți publica o intrare fără un fișier sau URL: '+e.id);
 }}
function validateFile(file){if(!file||typeof file.name!=='string')fail(400,'Alege un fișier.');const ext=file.name.split('.').pop().toLowerCase();const allow={'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp','mp4':'video/mp4','webm':'video/webm','pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};if(!allow[ext])fail(400,'Tip neacceptat; SVG/HTML/JavaScript sunt interzise.');if(file.size>15*1024*1024)fail(413,'Fișierul depășește limita de 15 MB / upload.');if(file.size===0)fail(400,'Fișier gol.');return ext}
function slug(str){return str.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,36)||'fisier'}
export default {async fetch(request,env){const c=cors(request,env);const origin=request.headers.get('origin');const allowed=(env.SITE_ORIGIN||'').replace(/\/$/,'');
 if(origin&&origin!==allowed)return reply({error:'Origine nepermisă.'},403,c);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:c});
 try{const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return reply({error:'Endpoint inexistent.'},404,c);
 // Fiecare cerere API trece prin verificarea parolei, inclusiv /api/me folosit la conectare.
 await verificaParola(request,env,request.headers.get('CF-Connecting-IP')||'necunoscut');
 if(url.pathname==='/api/me'&&request.method==='GET')return reply({ok:true},200,c);
 if(url.pathname==='/api/evidence'&&request.method==='GET'){const x=await getManifest(env);return reply(x,200,c)}
 if(url.pathname==='/api/evidence'&&request.method==='PUT'){
  const incoming=await request.json();if(typeof incoming.sha!=='string'||incoming.sha.length!==40)fail(400,'SHA GitHub lipsește.');
  const old=await getManifest(env);if(old.sha!==incoming.sha)fail(409,'Catalogul a fost modificat între timp. Reîncarcă.');
  const manifest=incoming.manifest;validateManifest(manifest);manifest.schemaVersion=1;manifest.updatedAt=new Date().toISOString();
  const s=ghSettings(env);const r=await github(env,`contents/${ghPath(s.manifest)}`,{method:'PUT',body:{message:'Update evidence catalogue (admin panel)',content:textToBase64(JSON.stringify(manifest,null,2)+'\n'),sha:old.sha,branch:s.branch}});return reply({ok:true,sha:r.content?.sha||'',updatedAt:manifest.updatedAt},200,c)
 }
 if(url.pathname==='/api/upload'&&request.method==='POST'){
  const length=Number(request.headers.get('content-length'));if(length>21*1024*1024)fail(413,'Fișier prea mare.');const form=await request.formData();const file=form.get('file');const ext=validateFile(file);
  const path=`docs/media/${Date.now()}-${crypto.randomUUID().slice(0,8)}-${slug(file.name)}.${ext}`;
  const body=await file.arrayBuffer();const s=ghSettings(env);
  await github(env,`contents/${ghPath(path)}`,{method:'PUT',body:{message:'Upload evidence attachment (admin panel)',content:bytesToBase64(body),branch:s.branch}});
  return reply({ok:true,path:path.replace(/^docs\//,''),bytes:body.byteLength},201,c)
 }
 if(url.pathname==='/api/media'&&request.method==='DELETE'){
  const path=url.searchParams.get('path')||'';if(!/^media\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|mp4|webm|pdf|docx)$/.test(path))fail(400,'Cale invalidă.');
  const s=ghSettings(env);const remote='docs/'+path;const item=await github(env,`contents/${ghPath(remote)}?ref=${encodeURIComponent(s.branch)}`);
  const r=await github(env,`contents/${ghPath(remote)}`,{method:'DELETE',body:{message:'Remove media (admin panel)',sha:item.sha,branch:s.branch}});return reply({ok:true,commit:r.commit?.sha},200,c)
 }
 return reply({error:'Ruta sau metoda nu există.'},404,c)
 }catch(error){const status=Number(error.status)||500;console.error('Worker request error:',status,error.message);return reply({error:error.message||'Eroare internă.'},status,c)}
}};
