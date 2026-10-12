# DOSAR PUBLIC / ASE — GitHub Pages + Cloudflare Worker

Website static în română, cu galerie, cronologie, filtre, fișe detaliate, surse și link / previzualizare live pentru petiția publică. Panoul `/admin/` editează catalogul printr-un **Cloudflare Worker** care scrie în GitHub. Pagina publică poate fi găzduită pe **GitHub Pages**, fără server propriu.

## Ce este inclus

- `docs/index.html` — landing page și arhiva de dovezi.
- `docs/admin/index.html` — interfață de administrare.
- `docs/data/evidence.json` — catalog cu **44 de intrări**: **43 de fișiere unice** rezultate din 56 fișiere inițiale (13 duplicate byte-cu-byte), plus petiția externă.
- `docs/media/` — **24 de înregistrări cu fișiere publicabile și previzualizări**, plus miniaturi; linkul petiției este a 25-a înregistrare publică. Fișierele aflate în revizuire sunt menționate doar în catalog, **nu sunt copiate în site**.
- `worker/src/index.js` — API protejat printr-o parolă de administrator (secretul `PAROLA`), cu comparare în timp constant și limitarea încercărilor în KV; CRUD pentru catalog, încărcare și ștergere de fișiere din depozitul GitHub.
- `tools/build_evidence.py` — script opțional de reimport inițial, care grupează duplicatele după SHA-256. **Suprascrie catalogul**, nu este destinat importurilor zilnice.

**Precizare editorială importantă:** Cele 19 fișiere unice marcate cu `review` pot include date personale, fragmente de conversații, materiale de presă protejate de drepturi de autor sau afirmații sensibile despre persoane. Nu le publica înainte de revizuire și, unde e necesar, anonimizare și obținerea drepturilor. Inventarul lor este disponibil doar din editor și prin datele JSON (titluri/denumiri/descrieri); conținutul brut nu este livrat sub `docs/`. Originalele rămân în arhiva ZIP furnizată de tine. **Repo-ul public include manifestul JSON**, deci pentru date sensibile din metadate modifică sau elimină acele câmpuri înainte de primul `git push`.

> Petiția publică: https://www.petitieonline.com/ore_online_in_ase_pan_la_rezolvarea_infestatiei_de_plonite
>
> Secțiunea dedicată folosește un `iframe` pentru previzualizarea live, plus link extern funcțional. Dacă Petitieonline.com nu permite încorporarea (X-Frame-Options / CSP), browserul va bloca afișarea în iframe. Nu putem eluda restricția platformei; linkul direct rămâne disponibil.

## Pasul 1 — Încarcă pe GitHub

1. Creează un repository GitHub, de exemplu `dosar-ase`, fără tokenuri sau date sensibile.
2. Într-un terminal, din directorul proiectului:

   ```bash
   git init
   git branch -M main
   git add docs worker README.md .gitignore tools
   git commit -m "Initial evidence archive and admin Worker"
   git remote add origin https://github.com/OWNER/dosar-ase.git
   git push -u origin main
   ```

3. În **Settings → Pages → Build and deployment**, alege **Deploy from a branch**, `main`, directorul **`/docs`**. Așteaptă publicarea.
4. Pagina publică este de forma `https://OWNER.github.io/dosar-ase/`. Fișierele existente, filtrarea, cronologia și linkul petiției sunt funcționale fără Worker.

**Adresa site-ului:** implicit `https://OWNER.github.io/dosar-ase/`, fără domeniu propriu. Dacă adaugi un domeniu în **Settings → Pages → Custom domain**, schimbă `SITE_ORIGIN` din Worker astfel încât să fie **identic** cu originea din browser (schemă HTTPS, fără cale și fără slash la final).

## Pasul 2 — Creează un token GitHub cu permisiuni minime

În GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.

- Acces numai la repository-ul site-ului.
- Permission **Contents: Read and write**.
- Tokenul trebuie să poată modifica ramura Pages (`main`). Dacă există branch protection, folosește un flux de aprobări separat; nu dezactiva protecția fără motiv.
- Păstrează tokenul numai ca secret în Cloudflare; **niciodată** în `docs/`, HTML, JavaScript de browser sau în `wrangler.toml`.

## Pasul 3 — Configurează și publică Cloudflare Worker

Ai nevoie de un cont Cloudflare și de Node.js 20+.

```bash
cd worker
cp wrangler.toml.example wrangler.toml
# editează GITHUB_REPO, GITHUB_BRANCH, SITE_ORIGIN și id-ul KV din [[kv_namespaces]]
npx wrangler login
npx wrangler kv namespace create LIMITE
npx wrangler secret put PAROLA
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

**Important:** `wrangler secret put` vizează Worker-ul declarat în `wrangler.toml`; după deploy, verifică în Cloudflare că secretul există la Worker-ul corect. Fișierul `wrangler.toml` este ignorat de Git. Un `wrangler.toml.example` fără date reale poate rămâne în Git.

Configurația se referă la:

| Nume | Exemplu / rol |
| --- | --- |
| `GITHUB_REPO` | `OWNER/dosar-ase` |
| `GITHUB_BRANCH` | `main` |
| `SITE_ORIGIN` | Originea paginii de admin, fără cale: `https://OWNER.github.io` |
| `PAROLA` | **Secret** Cloudflare Worker: parola administratorului (`wrangler secret put PAROLA`) |
| `GITHUB_TOKEN` | **Secret** Cloudflare Worker, nu o variabilă `[vars]` |
| binding `LIMITE` | Namespace KV pentru limitarea încercărilor de parolă (12 greșite pe IP, la 5 minute) |

## Pasul 4 — Parola administratorului

Nu sunt necesare Cloudflare Access, echipă Zero Trust sau conturi suplimentare. Adminul se conectează cu o parolă, păstrată ca secret pe Worker:

```bash
cd worker
npx wrangler secret put PAROLA
```

Folosește o parolă lungă și unică, generată de un manager de parole (de ex. 20+ caractere). Parola nu se pune în cod, în `wrangler.toml` sau în pagina statică.

1. Deschide `https://OWNER.github.io/dosar-ase/admin/` și verifică URL-ul Worker-ului (`https://ase-dosar-admin-api.<subdomeniu>.workers.dev`).
2. Introdu parola și apasă **Conectează-te**. Parola nu este salvată în browser: se pierde la reîncărcarea paginii.

**Securitate:** fiecare cerere la `/api/*` trebuie să trimită antetul `x-parola` cu parola corectă, altfel primește 401. Worker-ul acceptă cereri doar de la `SITE_ORIGIN`. Tokenul GitHub și parola rămân în secretele Worker-ului. Cine are parola poate modifica catalogul, deci schimb-o imediat dacă a fost expusă (`npx wrangler secret put PAROLA`).

## Pasul 5 — Adaugă sau modifică dovezi

1. `/admin/` → Conectare → Inventar.
2. Selectează o înregistrare sau **Adaugă dovadă**.
3. Completează titlul, descrierea, data, proveniența, categoria, tipul și statusul.
4. Pentru fotografii, video, PDF sau DOCX folosește **Încarcă în GitHub** (max. 15 MB / fișier). Se creează o cale `docs/media/...` în GitHub; apoi apasă **Salvează și publică modificările** pentru a lega fișierul de înregistrare.
5. Pentru petiții și surse externe, alege tipul **Link extern**, completează `url=https://...` și setează statusul `published`.
6. Pentru materiale care necesită verificare, folosește `review` sau `draft`. Vizitatorii vor vedea **numai** intrările `published` cu fișier ori URL valid.
7. Poți elimina o înregistrare din catalog. Originalele din repository nu sunt șterse automat pentru a evita pierderea accidentală a dovezilor. Eliminarea definitivă a unui fișier poate fi făcută în GitHub sau prin `DELETE /api/media?path=media/...` pentru administratorii autorizați.

**Limitări:** GitHub Pages este un hosting static și nu poate primi uploaduri ori păstra un login propriu. Commiturile către GitHub prin API necesită Worker. Uploadul integrat e limitat la 15 MB; fișierele mai mari se adaugă separat cu Git/LFS sau alt storage configurat, fără a depăși limitele Pages. **GitHub LFS nu este potrivit pentru a servi direct conținut prin Pages.** GitHub Pages poate avea întârziere după un commit (site-ul se actualizează după rebuild). Un commit nou nu șterge datele vechi din istoricul Git; dacă ai publicat accidental informații sensibile, tratează separat revocarea accesului și curățarea istoricului.

## Cum testezi local site-ul static

```bash
cd docs
python3 -m http.server 8080
# deschide http://localhost:8080/
```

Evită `file:///.../index.html` deoarece browserul poate bloca încărcarea JSON local prin `fetch()`.

## Integritatea dovezilor și responsabilitatea editorială

- `sha256` din manifest se referă la **fișierul original din arhivă**, nu la miniaturile sau copiile foto exportate fără EXIF și conversiile HEIC → JPEG. Pentru un upload nou din editor, calculează și notează separat SHA-256 și proveniența înainte de publicare, dacă dorești lanț de custodie complet.
- Data afișată este atribuită **numei originale a fișierului / sursei**, nu verificată printr-un expert. Nu confunda data încărcării cu data capturării.
- Nu afirma că o anumită specie de insectă a fost identificată tehnic fără o probă verificată și un raport de specialitate.
- Nu prezenta investigațiile sau materialele cu acuzații la adresa unor persoane ca fapte demonstrate. Notează dreptul la replică, rectificările și orice probe contrare.
- Nu republica mesaje private, date de contact, fețe identificabile sau materiale jurnalistice protejate fără a verifica temeiul legal și drepturile de utilizare.
- Păstrează copia originală a arhivei **offline / într-un spațiu privat**, împreună cu hashuri și o evidență cronologică a modificărilor. Repo-ul site-ului nu înlocuiește arhiva probatorie securizată.

## Reimportul inițial (opțional; atenție la pierderea editărilor)

```bash
python3 tools/build_evidence.py --zip "/path/catre/arhiva.zip"
# SAU
python3 tools/build_evidence.py --source "/path/catre/fișiere-extrase"
```

Acest utilitar reconstruiește `docs/data/evidence.json`, recalculând hashurile și normalizând numele; **suprascrie modificările făcute din admin**. Nu îl folosi ca metodă curentă de încărcare.

## Notă de proveniență

Proiectul este independent de ASE și de Petitieonline.com. Datele de pe petiție sunt dinamice; nu a fost inclus un număr fix de semnături deoarece se modifică. Petiția poate avea în browser un `iframe` blocat de politica site-ului sursă; linkul este alternativa garantată.
