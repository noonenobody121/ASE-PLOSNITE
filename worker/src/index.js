/** Cloudflare Worker: edit GitHub Pages evidence catalogue, authenticated with Cloudflare Access.
 * Deploy behind a Cloudflare Access application; verify its JWT on every protected request.
 * No GitHub token is ever delivered to the browser.
 */
const ENCODER = new TextEncoder();
let jwksCache = {issuer:'',at:0,keys:[]};
const reply = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const bytesToBase64 = buf => {const bytes=new Uint8Array(buf);let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(out)};
const textToBase64 = s => bytesToBase64(ENCODER.encode(s));
const base64ToText = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g,'')),c=>c.charCodeAt(0)));
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
async function verifyAccess(request,env){
 const issuer=(env.CF_ACCESS_ISSUER||'').replace(/\/$/,''); // https://<team>.cloudflareaccess.com
 const audience=env.CF_ACCESS_AUD;
 if(!issuer.startsWith('https://')||!audience)fail(500,'Cloudflare Access nu este configurat.');
 const token=request.headers.get('cf-access-jwt-assertion');
 if(!token)fail(401,'Autentificare necesară. Deschide mai întâi pagina de login Cloudflare Access.');
 const segments=token.split('.');if(segments.length!==3)fail(401,'JWT invalid.');
 let header,payload;
 try{header=JSON.parse(new TextDecoder().decode(b64uToBytes(segments[0])));payload=JSON.parse(new TextDecoder().decode(b64uToBytes(segments[1])))}catch{fail(401,'JWT invalid.')}
 if(header.alg!=='RS256'||!header.kid)fail(401,'Algoritm JWT nepermis.');
 const now=Math.floor(Date.now()/1000);
 if(payload.iss!==issuer||!Array.isArray(payload.aud)||!payload.aud.includes(audience)||typeof payload.exp!=='number'||payload.exp<=now||typeof payload.iat!=='number'||payload.iat>now+60||(payload.nbf&&payload.nbf>now+60))fail(401,'Token expirată sau emis de alt furnizor.');
 if(jwksCache.issuer!==issuer||Date.now()-jwksCache.at>300000){
  const r=await fetch(issuer+'/cdn-cgi/access/certs');if(!r.ok)fail(502,'Nu se pot verifica cheile Cloudflare Access.');
  const j=await r.json();if(!Array.isArray(j.keys))fail(502,'JWKS invalid.');jwksCache={issuer,keys:j.keys,at:Date.now()};
 }
 const jwk=jwksCache.keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)fail(401,'Semnătură JWT necunoscută.');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64uToBytes(segments[2]),ENCODER.encode(segments[0]+'.'+segments[1]));if(!ok)fail(401,'Semnătură JWT invalidă.');
 const email=(payload.email||'').toLowerCase();const allowed=(env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 if(!email||!allowed.length||!allowed.includes(email))fail(403,'Contul nu este pe lista administratorilor.');
 return {email,sub:payload.sub};
}
function cors(request,env){const origin=request.headers.get('origin');const allowed=(env.SITE_ORIGIN||'').replace(/\/$/,'');if(origin&&origin===allowed)return {'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,PUT,POST,DELETE,OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'Origin'};return {vary:'Origin'}}
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
function slug(str){return str.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,36)||'fisier'}
export default {async fetch(request,env){const c=cors(request,env);const origin=request.headers.get('origin');const allowed=(env.SITE_ORIGIN||'').replace(/\/$/,'');
 if(origin&&origin!==allowed)return reply({error:'Origine nepermisă.'},403,c);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:c});
 try{const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return reply({error:'Endpoint inexistent.'},404,c);
 // Cloudflare Access must protect /api/* at the edge; JWT is checked again here.
 const user=await verifyAccess(request,env);
 if(url.pathname==='/api/me'&&request.method==='GET')return reply({ok:true,email:user.email},200,c);
 if(url.pathname==='/api/evidence'&&request.method==='GET'){const x=await getManifest(env);return reply(x,200,c)}
 if(url.pathname==='/api/evidence'&&request.method==='PUT'){
  const incoming=await request.json();if(typeof incoming.sha!=='string'||incoming.sha.length!==40)fail(400,'SHA GitHub lipsește.');
  const old=await getManifest(env);if(old.sha!==incoming.sha)fail(409,'Catalogul a fost modificat între timp. Reîncarcă.');
  const manifest=incoming.manifest;validateManifest(manifest);manifest.schemaVersion=1;manifest.updatedAt=new Date().toISOString();
  const s=ghSettings(env);const r=await github(env,`contents/${ghPath(s.manifest)}`,{method:'PUT',body:{message:`Update evidence catalogue by ${user.email}`,content:textToBase64(JSON.stringify(manifest,null,2)+'\n'),sha:old.sha,branch:s.branch}});return reply({ok:true,sha:r.content?.sha||'',updatedAt:manifest.updatedAt},200,c)
 }
 if(url.pathname==='/api/upload'&&request.method==='POST'){
  const length=Number(request.headers.get('content-length'));if(length>21*1024*1024)fail(413,'Fișier prea mare.');const form=await request.formData();const file=form.get('file');const ext=validateFile(file);
  const path=`docs/media/${Date.now()}-${crypto.randomUUID().slice(0,8)}-${slug(file.name)}.${ext}`;
  const body=await file.arrayBuffer();const s=ghSettings(env);
  await github(env,`contents/${ghPath(path)}`,{method:'PUT',body:{message:`Upload evidence attachment by ${user.email}`,content:bytesToBase64(body),branch:s.branch}});
  return reply({ok:true,path:path.replace(/^docs\//,''),bytes:body.byteLength},201,c)
 }
 if(url.pathname==='/api/media'&&request.method==='DELETE'){
  const path=url.searchParams.get('path')||'';if(!/^media\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|mp4|webm|pdf|docx)$/.test(path))fail(400,'Cale invalidă.');
  const s=ghSettings(env);const remote='docs/'+path;const item=await github(env,`contents/${ghPath(remote)}?ref=${encodeURIComponent(s.branch)}`);
  const r=await github(env,`contents/${ghPath(remote)}`,{method:'DELETE',body:{message:`Remove media by ${user.email}`,sha:item.sha,branch:s.branch}});return reply({ok:true,commit:r.commit?.sha},200,c)
 }
 return reply({error:'Ruta sau metoda nu există.'},404,c)
 }catch(error){const status=Number(error.status)||500;console.error('Worker request error:',status,error.message);return reply({error:error.message||'Eroare internă.'},status,c)}
}};
