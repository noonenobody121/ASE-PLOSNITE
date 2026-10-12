'use strict';
const $ = s => document.querySelector(s);
const PETITION = 'https://www.petitieonline.com/ore_online_in_ase_pan_la_rezolvarea_infestatiei_de_plonite';
let records=[], filter='all', query='';
const fmtDate = d => d ? new Intl.DateTimeFormat('ro-RO',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')).toUpperCase() : 'DATĂ NECONFIRMATĂ';
const typeName = t => ({foto:'FOTOGRAFIE',video:'VIDEO',document:'DOCUMENT',link:'SURSĂ EXTERNĂ'})[t] || 'MATERIAL';
const fileUrl = p => p && /^(media\/[a-z0-9-]+\.(?:jpe?g|png|webp|mp4|pdf|docx|webm))$/i.test(p) ? new URL(p,document.baseURI).href : '';
const safeUrl = u => {try{const a=new URL(u);return a.protocol==='https:'?a.href:''}catch{return ''}};
function elt(tag, cls, text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x}
function imgEl(src,alt){let im=elt('img');im.loading='lazy';im.src=src;im.alt=alt;return im}
function card(r){
 const b=elt('button','evidence-card');b.type='button';b.setAttribute('aria-label','Deschide '+r.title);b.onclick=()=>openModal(r);
 const med=elt('div','evidence-media');const img=fileUrl(r.thumbnail||(/\.(?:jpe?g|png|webp)$/i.test(r.path||'')?r.path:''));
 if(img)med.append(imgEl(img,r.title));else med.append(elt('div','empty-preview',r.type==='link'?'↗':'▤'));
 med.append(elt('span','type-pill',typeName(r.type)));if(r.type==='video')med.append(elt('div','play-indicator','▶'));b.append(med);
 const content=elt('div','evidence-info');const meta=elt('div','evidence-meta');meta.append(elt('span','',fmtDate(r.date)),elt('span','',r.id));content.append(meta);
 content.append(elt('h3','',r.title));content.append(elt('p','',r.description));const foot=elt('div','card-bottom');foot.append(elt('span','',r.source||'ARHIVĂ'),elt('span','','↗'));content.append(foot);b.append(content);return b;
}
function render(){const shown=records.filter(r=>(filter==='all'||r.type===filter)&&(!query||[r.title,r.description,r.location,r.filename,r.date,r.id].join(' ').toLocaleLowerCase('ro').includes(query)));
 const grid=$('#evidence-grid');grid.replaceChildren();if(!shown.length){grid.append(elt('p','no-results','Nu există materiale pentru această selecție. Încearcă alte filtre.'));return}
 shown.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id)).forEach(r=>grid.append(card(r)));
}
function openModal(r){const dialog=$('#evidence-modal'),body=$('#modal-body');body.replaceChildren();const grid=elt('div','modal-body-grid'),preview=elt('div','modal-preview');
 if(r.type==='foto'&&fileUrl(r.path))preview.append(imgEl(fileUrl(r.path),r.title));
 else if(r.type==='video'&&fileUrl(r.path)){const video=elt('video');video.src=fileUrl(r.path);video.controls=true;video.playsInline=true;video.preload='metadata';if(fileUrl(r.thumbnail))video.poster=fileUrl(r.thumbnail);preview.append(video)}
 else if(r.type==='document'&&r.path?.toLowerCase().endsWith('.pdf')&&fileUrl(r.path)){const frame=elt('iframe');frame.src=fileUrl(r.path);frame.title='Document PDF: '+r.title;preview.append(frame)}
 else if(r.type==='link'){const link=elt('div','petition-modal');link.append(elt('h3','',r.title),elt('p','',r.description));preview.append(link)}
 else preview.append(elt('div','empty-preview','▤'));
 const data=elt('div','modal-description');data.append(elt('div','eyebrow',`${typeName(r.type)} / ${r.id}`),elt('h2','',r.title),elt('p','',r.description));
 const fields=elt('dl','modal-fields');[['Dată indicată',fmtDate(r.date)],['Sursă',r.source||'—'],['Loc indicat',r.location||'Neatribuit'],['Fișier inițial',r.filename||'—'],['Copii identice',String(Math.max(0,(r.originalNames||[]).length-1))]].forEach(([k,v])=>{const row=elt('div');row.append(elt('dt','',k),elt('dd','',v));fields.append(row)});data.append(fields);
 const buttons=elt('div','modal-buttons');const href=r.type==='link'?safeUrl(r.url):fileUrl(r.path);if(href){const link=elt('a','',r.type==='link'?'Deschide petiția ↗':'Deschide fișierul ↗');link.href=href;link.target='_blank';link.rel='noopener noreferrer';if(r.type!=='link')link.download='';buttons.append(link)}const copy=elt('button','','Copiază identificatorul');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(r.id);copy.textContent='Copiat'}catch{copy.textContent=r.id}};buttons.append(copy);data.append(buttons);
 if(r.sha256)data.append(elt('p','modal-sha','SHA-256 al fișierului din arhiva inițială: '+r.sha256));grid.append(preview,data);body.append(grid);dialog.showModal();document.body.classList.add('modal-open');
}
$('#modal-close').addEventListener('click',()=>$('#evidence-modal').close());$('#evidence-modal').addEventListener('close',()=>{document.body.classList.remove('modal-open');$('#modal-body').querySelector('video')?.pause()});$('#evidence-modal').addEventListener('click',e=>{if(e.target===$('#evidence-modal'))$('#evidence-modal').close()});
$('#archive-search').addEventListener('input',e=>{query=e.target.value.trim().toLocaleLowerCase('ro');render()});
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter=b.dataset.filter;render()}));
$('#mobile-toggle').addEventListener('click',()=>{const nav=$('.nav');const open=nav.classList.toggle('open');$('#mobile-toggle').setAttribute('aria-expanded',String(open))});document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>$('.nav').classList.remove('open')));
(async()=>{try{const res=await fetch('data/evidence.json',{cache:'no-cache'});if(!res.ok)throw Error(res.status);const data=await res.json();records=(data.evidence||[]).filter(r=>r.status==='published'&&(r.type==='link'?!!safeUrl(r.url):!!fileUrl(r.path)));for(const t of ['foto','video','document','link'])$('#count-'+t).textContent=records.filter(r=>r.type===t).length;$('#count-all').textContent=records.length;
 $('#metric-media').textContent=records.length;$('#metric-images').textContent=records.filter(r=>r.type==='foto').length;$('#metric-videos').textContent=records.filter(r=>r.type==='video').length;
 const hero=records.find(r=>r.type==='foto'&&r.filename?.includes('5.10.2026')&&fileUrl(r.path))||records.find(r=>r.type==='foto'&&fileUrl(r.path));if(hero)$('#hero-image').style.backgroundImage=`linear-gradient(0deg,rgba(10,8,8,.18),transparent),url("${fileUrl(hero.path)}")`;
 render()}catch(e){console.error('Failed loading evidence manifest',e);$('#evidence-grid').replaceChildren(elt('p','no-results','Arhiva nu poate fi încărcată. Rulează site-ul printr-un server HTTP (nu direct ca fișier local) sau încearcă din nou.'))}})();
