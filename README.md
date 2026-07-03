# Micro-service FISCAL — pour le workflow n8n

Deux endpoints utilisés par le workflow `FISCAL_SYNTHESE_AR_FR` :

- **POST `/pdf-to-images`** : reçoit un PDF scanné (champ `file`, multipart/form-data) → renvoie `{ images: [ { page, b64 } ] }`.
- **POST `/build-pdf`** : reçoit `{ synthese: {...} }` (le JSON produit par GPT) → renvoie directement le **PDF** de la synthèse française.
- **GET `/`** : health check (`{ status: "ok" }`).

---

## Déploiement sur Railway (pas à pas)

### 1. Mettre le code sur GitHub
1. Créez un dépôt GitHub vide (ex. `fiscal-microservice`).
2. Uploadez tout le contenu de ce dossier **SAUF `node_modules/`** (déjà exclu par `.gitignore`).
   - Via l'interface GitHub : "Add file" → "Upload files" → glissez `server.js`, `package.json`, `package-lock.json`, `Dockerfile`, `.gitignore`, `README.md`.

### 2. Créer le projet Railway
1. Allez sur https://railway.app → connectez-vous avec GitHub.
2. "New Project" → "Deploy from GitHub repo" → choisissez votre dépôt.
3. Railway détecte le **Dockerfile** et lance le build automatiquement (il installe GraphicsMagick + Ghostscript, nécessaires à la conversion PDF→images).

### 3. Exposer l'URL publique
1. Onglet **Settings** du service → section **Networking** → "Generate Domain".
2. Vous obtenez une URL du type `https://fiscal-microservice-production.up.railway.app`.

### 4. (Recommandé) Protéger par une clé d'API
1. Onglet **Variables** → ajoutez `API_KEY` = une valeur secrète de votre choix.
2. Côté n8n, dans les deux nodes HTTP Request, activez **Send Headers** et ajoutez :
   - Name : `x-api-key`  ·  Value : la même valeur.
   - (Si vous ne définissez pas `API_KEY`, le service reste ouvert — acceptable pour une démo.)

### 5. Brancher dans n8n
Dans le workflow, remplacez `https://VOTRE-MICROSERVICE` par votre URL Railway dans les 2 nodes :
- **PDF → Images (microservice)** → `https://VOTRE-URL/pdf-to-images`
- **Build PDF (microservice)** → `https://VOTRE-URL/build-pdf`

### 6. Tester
- Health : ouvrez `https://VOTRE-URL/` dans le navigateur → doit afficher `{"status":"ok",...}`.
- Puis lancez le workflow depuis le formulaire n8n avec un vrai PDF.

---

## Test local (optionnel)
```bash
npm install
npm start
# health
curl http://localhost:3000/
```

## Notes techniques
- `pdf2pic` nécessite **GraphicsMagick** et **Ghostscript** : c'est pourquoi on utilise le `Dockerfile` (ils y sont installés). Ne pas déployer en buildpack Node simple sans ces binaires.
- Densité de rendu réglée à 150 DPI (bon compromis lisibilité/taille) dans `server.js`.
- Le PDF de sortie est généré avec `pdfkit`, sans dépendance système.
