# MMO'ZEROTH

*[English below](#english)*

Un jeu de gestion dans le navigateur : vous êtes le studio d'un MMORPG à l'ancienne. Vous remplissez la région de Durotar (camps de créatures, PNJ, quêtes, objets, classes, le Gouffre de Ragefeu), puis vous regardez des centaines de joueurs simulés y jouer, se plaindre dans le canal général, s'abonner… ou résilier.

- **Bac à sable** : pas d'argent ni d'objectifs, temps réglable, outils de test (faire apparaître un joueur, le suivre, forcer son niveau).
- **Carrière** : budget limité, abonnements et essais gratuits, serveurs, publicité, mises à jour payantes, studios concurrents, objectifs à atteindre et faillite possible.

> **Aucune ressource du jeu d'origine n'est incluse dans ce dépôt.** Il ne contient que du code et des formes de remplacement. Les images (terrain, modèles, icônes) et les données de jeu sont extraites **sur votre ordinateur**, depuis **votre propre** client 3.3.5a, par l'outil d'extraction fourni. Ce projet n'a aucun lien avec l'éditeur du jeu d'origine.

## Installation

### 1. Ce qu'il faut

- [Node.js](https://nodejs.org/) **24** (22.18 au minimum).
- [Git](https://git-scm.com/).
- Facultatif, pour le vrai terrain et les vrais modèles : un client 3.3.5a (build 12340) que vous possédez déjà. Sans lui, le jeu fonctionne avec une fausse carte et des formes simples.

### 2. Récupérer le projet

```bash
git clone https://github.com/<compte>/mmozeroth.git
cd mmozeroth
npm install
```

### 3. Jouer tout de suite (sans ressources)

```bash
npm run dev
```

Puis ouvrez l'adresse affichée (en général http://localhost:5173). Sous Windows, vous pouvez aussi double-cliquer sur `lancer.bat`.

### 4. Extraire les ressources (facultatif, conseillé)

Les données de jeu (objets, créatures, sorts par niveau, boss du Gouffre de Ragefeu) viennent des fichiers SQL du projet libre [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk). Il suffit d'en télécharger les tables du monde (environ 400 Mo) :

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/azerothcore/azerothcore-wotlk.git
cd azerothcore-wotlk
git sparse-checkout set data/sql/base/db_world
cd ..
```

Indiquez ensuite où se trouvent AzerothCore et votre client : copiez `extract.example.json` en `extract.local.json` et remplissez les deux chemins (ce fichier reste sur votre ordinateur). Lancez enfin :

```bash
npm run extract
```

L'extraction prend environ une minute. Elle crée le dossier `resource-pack/` (environ 70 Mo) : données, icônes, terrain de Durotar et planches d'images des modèles. Ce dossier est ignoré par Git et ne doit jamais être partagé. Relancez `npm run dev` : le vrai terrain s'affiche.

Sans client, mettez seulement le chemin d'AzerothCore : vous aurez les données (objets, boss, sorts) mais pas les images.

### Sauvegardes

La partie est sauvegardée automatiquement dans le navigateur. Les boutons **Exporter** et **Importer** permettent de la garder dans un fichier. Une partie faite sur la fausse carte ne se charge pas sur le vrai terrain, et inversement.

## Pour les développeurs

- `npm run build` : vérification des types (jeu et outil d'extraction) puis construction.
- `src/sim/` : la simulation, dans un Web Worker (joueurs, combats, humeur, instance, économie de la carrière).
- `src/game/`, `src/ui/` : l'affichage (PixiJS) et l'interface.
- `tools/extract/` : l'outil d'extraction, avec ses propres lecteurs des formats du client (archives MPQ, DBC, BLP, ADT, M2) et un petit moteur de rendu logiciel qui transforme les modèles 3D en images.

---

<a id="english"></a>

# MMO'ZEROTH (English)

A browser management game: you run the studio behind an old-school MMORPG. You fill the Durotar region (creature camps, NPCs, quests, items, classes, Ragefire Chasm), then watch hundreds of simulated players play, complain in the general chat, subscribe… or cancel.

- **Sandbox**: no money or goals, adjustable time, test tools (spawn a player, follow them, force their level).
- **Career**: limited budget, subscriptions and free trials, servers, advertising, paid updates, rival studios, objectives to reach, and possible bankruptcy.

> **No assets from the original game are included in this repository.** It only contains code and placeholder shapes. Images (terrain, models, icons) and game data are extracted **on your computer**, from **your own** 3.3.5a client, by the included extraction tool. This project is not affiliated with the publisher of the original game.

## Installation

### 1. Requirements

- [Node.js](https://nodejs.org/) **24** (22.18 at least).
- [Git](https://git-scm.com/).
- Optional, for the real terrain and models: a 3.3.5a client (build 12340) you already own. Without it, the game runs on a placeholder map with simple shapes.

### 2. Get the project

```bash
git clone https://github.com/<account>/mmozeroth.git
cd mmozeroth
npm install
```

### 3. Play right away (no assets)

```bash
npm run dev
```

Then open the address shown (usually http://localhost:5173). On Windows you can also double-click `lancer.bat`.

### 4. Extract the assets (optional, recommended)

Game data (items, creatures, spells by level, Ragefire Chasm bosses) comes from the SQL files of the open-source [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) project. You only need its world tables (about 400 MB):

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/azerothcore/azerothcore-wotlk.git
cd azerothcore-wotlk
git sparse-checkout set data/sql/base/db_world
cd ..
```

Then tell the tool where AzerothCore and your client are: copy `extract.example.json` to `extract.local.json` and fill in both paths (that file stays on your computer). Finally run:

```bash
npm run extract
```

Extraction takes about a minute. It creates the `resource-pack/` folder (about 70 MB): data, icons, Durotar terrain and model sprite sheets. Git ignores this folder and it must never be shared. Run `npm run dev` again: the real terrain shows up.

Without a client, only set the AzerothCore path: you get the data (items, bosses, spells) but no images.

### Saves

The game is saved automatically in the browser. The **Export** and **Import** buttons keep it in a file. A game made on the placeholder map can't be loaded on the real terrain, and vice versa.

## For developers

- `npm run build`: type check (game and extraction tool), then build.
- `src/sim/`: the simulation, in a Web Worker (players, combat, mood, instance, career economy).
- `src/game/`, `src/ui/`: rendering (PixiJS) and interface.
- `tools/extract/`: the extraction tool, with its own readers for the client formats (MPQ archives, DBC, BLP, ADT, M2) and a small software renderer that turns 3D models into images.
