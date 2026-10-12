#!/usr/bin/env python3
"""Build normalized metadata and public media from the user-provided ZIP.
   Flagged sources remain described as review items, and MUST NOT be copied into docs/media."""
from pathlib import Path
import argparse, zipfile, tempfile
from collections import defaultdict
from datetime import date
import hashlib,re,json,shutil,subprocess,unicodedata,os
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Importă materialele inițiale în catalog (ATENȚIE: suprascrie catalogul existent).')
parser.add_argument('--source',help='Director cu fișierele extrase din arhivă')
parser.add_argument('--zip',help='Arhiva ZIP originală')
args=parser.parse_args()
if not args.source and not args.zip: parser.error('Indică --source DIR sau --zip ARHIVA.zip')
_tmp=None
if args.zip:
 _tmp=tempfile.TemporaryDirectory()
 with zipfile.ZipFile(args.zip) as z:
  entries=[i for i in z.infolist() if not i.is_dir()]
  if sum(i.file_size for i in entries)>350*1024*1024 or len(entries)>1000: parser.error('Arhiva este prea mare.')
  for index,item in enumerate(entries):
   # No ZIP entry paths are trusted; flatten to safe numbered temporary files.
   from pathlib import PurePosixPath
   orig_name=PurePosixPath(item.filename).name
   target=Path(_tmp.name)/orig_name
   if not orig_name or target.exists():continue
   with z.open(item) as fi, target.open('wb') as fo: shutil.copyfileobj(fi,fo)
 SRC=Path(_tmp.name)
else:
 SRC=Path(args.source)
OUT=ROOT/'docs'
MEDIA=OUT/'media';MEDIA.mkdir(exist_ok=True,parents=True)
# Destructive initializer: avoid leaving stale public files after a fresh import.
for _old in MEDIA.iterdir():
 if _old.is_file():_old.unlink()

def sanitize(s):
 s=unicodedata.normalize('NFKD',s)
 s=''.join(c for c in s if not unicodedata.combining(c)).lower()
 return (re.sub(r'[^a-z0-9]+','-',s).strip('-')[:55] or 'dovada')

def title_of(n):
 s=n.rsplit('.',1)[0]
 sl=s.lower()
 if 'cladirea 2, 5.10.2026' in sl and 'video' not in sl: return 'Observații fotografice — clădirea 2, etajul 1'
 if 'video dezmintire' in sl: return 'Înregistrare video — clădirea 2, 5 octombrie'
 if '05.10.2026 comunicare' in sl: return 'Comunicare referitoare la situație — 5 octombrie'
 if 'cereri rectorat' in sl: return 'Solicitări de informații către rectorat'
 if 'digi24 raportaj' in sl: return 'Reportaj Digi24 — material video'
 if 'countermeasures' in sl: return 'Măsuri observate în spațiul universitar'
 if 'cibernetica_etaj1_profesori' in sl: return 'Imagine din spațiul universitar — necesita revizuire'
 if 'cibernetica_etaj1' in sl: return 'Fotografie din spațiul universitar'
 if 'rip' in sl: return 'Observație fotografică pe pardoseală'
 if sl.startswith('sala') or sl.startswith('cladirea2') or sl.startswith('ase,'):
  return 'Documentare din spațiul universitar — '+re.sub(r'[_,-]',' ',s).strip()[:52]
 if s.strip(' _()0123456789')=='':return 'Înregistrare video cu observații apropiate'
 if sl.startswith('camin') or sl.startswith('cămin'): return 'Înregistrare din spațiul de cazare studențesc'
 if sl.startswith('problema_'): return 'Mesaj referitor la sesizările studenților'
 if sl.startswith('mail for'): return 'Model de solicitare către conducere'
 if sl.startswith('mesaj de pe'): return 'Mesaj relatat într-un grup de studenți'
 if 'greva' in sl: return 'Material de presă despre situația de la Universitatea de Arhitectură'
 if sl.startswith('dosar_') or sl.startswith('info dump') or sl.startswith('ase - coral'): return 'Material de analiză nevalidat independent — '+s[:35]
 if 'lista' in sanitize(sl) and 'stiri' in sanitize(sl): return 'Listă de surse și articole de presă'
 if sl in {'conducerea_ase','mediafox','protv','libertatea'}: return 'Captură arhivată a unui material de presă — '+s.capitalize()
 return re.sub(r'[_]',' ',s).strip()[:90]

def getdate(s):
 m=re.search(r'(?<!\d)(\d{1,2})[. ,_-]+(\d{1,2})[. ,_-]+(202[456])(?!\d)',s)
 if m:
  dd,mm,yyyy=map(int,m.groups())
  try:return date(yyyy,mm,dd).isoformat()
  except:pass
 m2=re.search(r'(?<!\d)(\d{1,2})[ ._-]+(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|noi|dec)[a-z]*[ ._-]+(202[456])(?!\d)',s.lower())
 if m2:
  dd,month,yyyy=m2.groups();mm=['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','noi','dec'].index(month)+1
  try:return date(int(yyyy),mm,int(dd)).isoformat()
  except:pass
 return None

def review_reason(n):
 s=n.lower(); ext=Path(n).suffix.lower()
 if n in {'Mail for decan_secretariat.docx','Listă Știri ASE Ploșnițe.docx'}:return ''
 if ext in {'.docx','.html'}:return 'Document text: verifică date personale, conținut terț și informații neverificate.'
 if ext == '.pdf':return 'PDF: verifică drepturile de republicare, datele personale și afirmațiile despre terți.'
 if 'comunicare' in s or 'cereri rectorat' in s or 'problema_plosnite' in s or '02.10.2026.jpg'==s or 'cibernetica_etaj1_profesori' in s: return 'Captură sau imagine care poate conține date personale; revizuire necesară.'
 if 'digi24' in s: return 'Material video realizat de o redacție; verificați drepturile de republicare.'
 return ''

def kind(ext):
 if ext in {'.png','.jpg','.jpeg','.heic'}:return 'foto'
 if ext in {'.mp4','.mov','.webm'}:return 'video'
 return 'document'

def category(n, k):
 s=n.lower()
 if any(x in s for x in ['comunicare','cereri','mail for','mesaj de pe','02.10.2026.jpg']): return 'corespondenta'
 if any(x in s for x in ['investigat','dosar','coral','stiri','greva','libertatea','protv','mediafox','digi24','conducerea_ase']):return 'presa'
 return 'teren'

def desc(n,k,review):
 if review:return 'Fișier inventariat din arhiva furnizată. Publicarea conținutului integral necesită revizuire manuală.'
 if k=='foto':return 'Fotografie furnizată de studenți și asociată de numele fișierului cu documentarea situației. Localizarea și identificarea insectelor necesită verificare independentă.'
 if k=='video':return 'Filmarea este parte a materialelor puse la dispoziție pentru documentarea sesizărilor. Data și locul sunt indicate de denumirea inițială, nu verificate independent.'
 return 'Document din arhiva furnizată; interpretarea lui trebuie raportată la conținutul original.'

files=sorted([p for p in SRC.iterdir() if p.is_file()],key=lambda p:p.name.lower())
groups={}
for f in files:
 h=hashlib.sha256(f.read_bytes()).hexdigest()
 groups.setdefault(h,[]).append(f)
# prefer original with least trailing duplication suffix
rank=lambda p: (bool(re.search(r' \(\d+\)\.',p.name)),len(p.name),p.name)
ordered=sorted(groups.items(),key=lambda kv:min(rank(x) for x in kv[1]))
items=[]
for ix,(h,paths) in enumerate(ordered,1):
 p=min(paths,key=rank); name=p.name;ex=p.suffix.lower();k=kind(ex);review=review_reason(name)
 # if duplicate names differ in risk, review if ANY variant is sensitive.
 if not review:
  for alt in paths:
   if review_reason(alt.name): review=review_reason(alt.name);break
 id='ASE-'+str(ix).zfill(3)
 title=title_of(name); dt=getdate(name) or next((getdate(x.name) for x in paths if getdate(x.name)),None)
 item={'id':id,'title':title,'type':k,'category':category(name,k),'date':dt,'location':'Academia de Studii Economice din București' if category(name,k)=='teren' else '',
       'description':desc(name,k,review),'source':'Arhivă furnizată de studenți','filename':name,'originalNames':[p.name for p in paths],
       'sha256':h,'bytes':p.stat().st_size,'status':'review' if review else 'published','reviewNote':review,
       'path':'','thumbnail':'','createdAt':'2026-10-12T00:00:00Z'}
 if not review:
  destname=f'{id.lower()}-{sanitize(name.rsplit(".",1)[0])}'
  if ex in {'.heic'} or (ex in {'.png','.jpeg'} and p.read_bytes()[:12].find(b'ftyp')!=-1):
   out=MEDIA/(destname+'.jpg');
   subprocess.run(['ffmpeg','-v','error','-y','-i',str(p),'-frames:v','1','-q:v','2',str(out)],check=True,timeout=30)
   item['path']='media/'+out.name
   # hashes refer to original HEIC content, not converted preview
   item['description']+=' Fișierul public este o conversie pentru compatibilitate web; SHA-256 indică sursa originală.'
  else:
   if k=='foto':
    out=MEDIA/(destname+'.jpg')
    with Image.open(p) as im:
     im=ImageOps.exif_transpose(im).convert('RGB')
     im.save(out,'JPEG',quality=93,optimize=True)
   else:
    out=MEDIA/(destname+ex);shutil.copy2(p,out)
   item['path']='media/'+out.name
  if k=='foto':
   item['description']+=' Copia publică a fost exportată fără metadatele foto originale; amprenta SHA-256 aparține fișierului inițial.'
   thumb=MEDIA/(destname+'-thumb.jpg')
   with Image.open(out) as im:
    im=ImageOps.exif_transpose(im);im.thumbnail((1100,760));im.convert('RGB').save(thumb,'JPEG',quality=81,optimize=True)
   item['thumbnail']='media/'+thumb.name
  elif k=='video':
   thumb=MEDIA/(destname+'-poster.jpg')
   try:
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss','00:00:01','-i',str(out),'-frames:v','1','-q:v','3','-y',str(thumb)],check=True,timeout=20)
    item['thumbnail']='media/'+thumb.name
   except Exception as e:print('video thumbnail unavailable',name,e)
 items.append(item)
items.append({'id':'PET-001','title':'Petiția studenților pentru cursuri online până la soluționarea situației',
 'type':'link','category':'initiativa','date':'2026-10-01','location':'Online — Petitieonline.com',
 'description':'Petiție publică prin care se solicită cursuri și seminare online până la soluționarea problemei semnalate. Reprezintă o inițiativă civică și nu certifică, prin ea însăși, circumstanțele relatate.',
 'source':'Petitieonline.com','filename':'Petiție online (sursă externă)','originalNames':[], 'sha256':'','bytes':0,
 'status':'published','reviewNote':'','path':'','thumbnail':'','url':'https://www.petitieonline.com/ore_online_in_ase_pan_la_rezolvarea_infestatiei_de_plonite','createdAt':'2026-10-12T00:00:00Z'})
OUT.joinpath('data/evidence.json').write_text(json.dumps({'schemaVersion':1,'updatedAt':'2026-10-12T00:00:00Z','evidence':items},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('records',len(items),'published',sum(i['status']=='published' for i in items),'review',sum(i['status']=='review' for i in items),'originals',len(files),'duplicates',len(files)-(len(items)-1))
print('public bytes',sum(f.stat().st_size for f in MEDIA.iterdir()))
