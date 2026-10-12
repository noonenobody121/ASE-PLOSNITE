# DOSAR PUBLIC / ASE — GitHub Pages + Cloudflare Access + Worker

Website static în română, cu galerie, cronologie, filtre, fișe detaliate, surse și link / previzualizare live pentru petiția publică. Panoul `/admin/` editează catalogul printr-un **Cloudflare Worker** care scrie în GitHub. Pagina publică poate fi găzduită pe **GitHub Pages**, fără server propriu.

## Ce este inclus

- `docs/index.html` — landing page și arhiva de dovezi.
- `docs/admin/index.html` — interfață de administrare.
- `docs/data/evidence.json` — catalog cu **44 de intrări**: **43 de fișiere unice** rezultate din 56 fișiere inițiale (13 duplicate byte-cu-byte), plus petiția externă.
- `docs/media/` — **24 de înregistrări cu fișiere publicabile și previzualizări**, plus miniaturi; linkul petiției este a 25-a înregistrare publică. Fișierele aflate în revizuire sunt menționate doar în catalog, **nu sunt copiate în site**.
- `worker/src/index.js` — API protejat prin JWT Cloudflare Access, cu verificarea semnăturii prin JWKS, verificarea audienței și restricționare la emailuri aprobate; CRUD pentru catalog, încărcare și ștergere de fișiere din depozitul GitHub.
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

**Recomandat pentru autentificare:** configurează în **Settings → Pages → Custom domain** adresa `dovezi.example.ro`, prin DNS, astfel încât să poți avea Worker pe `api.dovezi.example.ro`. Două subdomenii ale aceluiași domeniu reduc problemele cu cookie-urile Cloudflare Access față de combinația `github.io` + `workers.dev`. `SITE_ORIGIN` din Worker trebuie să fie **identic**, cu schemă HTTPS și fără slash la final, cu originea din browser.

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
# editează GITHUB_REPO, GITHUB_BRANCH, SITE_ORIGIN,
# CF_ACCESS_ISSUER, CF_ACCESS_AUD, ADMIN_EMAILS
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

**Important:** `wrangler secret put` vizează Worker-ul declarat în `wrangler.toml`; după deploy, verifică în Cloudflare că secretul există la Worker-ul corect. Fișierul `wrangler.toml` este ignorat de Git. Un `wrangler.toml.example` fără date reale poate rămâne în Git.

Configurația se referă la:

| Nume | Exemplu / rol |
| --- | --- |
| `GITHUB_REPO` | `OWNER/dosar-ase` |
| `GITHUB_BRANCH` | `main` |
| `SITE_ORIGIN` | `https://dovezi.example.ro` |
| `CF_ACCESS_ISSUER` | `https://TEAM.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | **Application Audience (AUD) Tag** din Access |
| `ADMIN_EMAILS` | Lista emailurilor de administrator, separate prin virgulă |
| `GITHUB_TOKEN` | **Secret** Cloudflare Worker, nu o variabilă `[vars]` |

Asociază un **custom domain** Worker-ului: `api.dovezi.example.ro` din Cloudflare Dashboard → Workers & Pages → Worker → Settings → Domains & Routes (terminologia poate varia).

## Pasul 4 — Activează Cloudflare Access (obligatoriu)

1. Cloudflare Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Protejează `api.dovezi.example.ro` (inclusiv `/api/*`).
3. Creează o **Allow policy** limitată strict la adresele tale de email/identitățile aprobate; activează login OTP sau un Identity Provider controlat. Nu crea o politică globală „Everyone”.
4. Copiază **Application Audience (AUD) Tag** în `CF_ACCESS_AUD` și **Team domain** în `CF_ACCESS_ISSUER`.
5. Asigură-te că preflight **OPTIONS** către API este tratat fără redirecționare de login, pentru CORS (de ex. opțiunea Access dedicată preflight requests / bypass OPTIONS; nu aplica bypass celorlalte metode). Worker răspunde singur la OPTIONS.
6. Publică din nou Worker după configurare: `npx wrangler deploy`.
7. În `https://dovezi.example.ro/admin/`, introdu `https://api.dovezi.example.ro` și salvează URL-ul. Apasă **1. Autentifică-te** și finalizează loginul în fereastra nouă, apoi **2. Conectează-te**.

**Securitate:** `/admin/` este o interfață statică public accesibilă, dar toate operațiunile de citire/editare prin API solicită un JWT valid **semnat de Cloudflare Access**, emis pentru audiența corectă și asociat unui email din `ADMIN_EMAILS`. API-ul respinge originile neautorizate. Tokenul GitHub rămâne server-side. Ascunderea butoanelor nu este măsură de securitate: Worker-ul verifică fiecare cerere.

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
