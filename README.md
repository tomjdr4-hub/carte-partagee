# Carte partagée

Module autonome pour Foundry VTT v14. Il ouvre une fenêtre contenant des cartes (images) et leurs annotations : épingles et zones.

## Fonctionnalités

- **Plusieurs cartes** sous forme d'onglets. Une nouvelle carte est **cachée aux joueurs** jusqu'à ce que le MJ la rende visible (bouton *Cachée / Visible*).
- **Montrer aux joueurs** : ouvre la carte chez tous les joueurs connectés (et la rend visible si besoin).
- **Épingles et zones** à main levée, avec titre et description, modifiables et supprimables ensuite. Les épingles se déplacent par glisser-déposer.
- **Annotations secrètes** : visibles uniquement par le MJ, révélables d'un clic (icône œil sur la fiche).
- **Zoom et déplacement** : molette ou boutons − / + pour zoomer, glisser pour déplacer (clic molette avec les outils de dessin), *100 %* pour revenir à la vue d'ensemble.
- Le nom des zones est affiché sur la carte. Cliquer sur une fiche la fait clignoter sur la carte (et centre la vue si on est zoomé) ; cliquer sur une épingle ou une zone met sa fiche en évidence.
- **Notes personnelles** : l'icône carnet d'une fiche ouvre, dans le journal **Notes de <joueur>** (dossier *Carte partagée*), la page de notes de cette annotation. Elle est créée au premier clic et s'ouvre directement en écriture. Seuls le joueur et le MJ peuvent la lire ; rien ne s'affiche sur la carte.

> Les éléments cachés ne sont pas affichés aux joueurs, mais ils font partie des données du monde envoyées à tous les clients : un joueur qui fouille la console du navigateur pourrait les lire.

## Installation locale

Copiez le dossier `carte-partagee` dans `Data/modules/`, puis activez **Carte partagée** dans les paramètres de modules du monde.

Installation depuis Foundry : **Modules complémentaires** > **Installer un module**, puis collez le manifeste :

```text
https://github.com/tomjdr4-hub/carte-partagee/releases/latest/download/module.json
```

### Droits

Aucune permission Foundry à modifier : quand le MJ se connecte, le module crée pour chaque joueur un journal dont il est propriétaire, et les notes y sont ajoutées comme pages. Un joueur créé pendant que le MJ est connecté reçoit son journal immédiatement ; sinon, à la prochaine connexion du MJ. L'import d'image écrit dans `Data/worlds/<monde>/carte-partagee/`.

## Utilisation

1. Ouvrir la carte avec le bouton **Carte partagée** : dans les outils de scène (groupe Jetons, à gauche) ou en haut de l'onglet **Journaux**. Macro possible : `game.modules.get("carte-partagee").api.openMap()`.
2. En tant que MJ, cliquer sur **+ Carte**, la renommer si besoin, importer une image, puis la rendre **Visible** ou cliquer sur **Montrer**.
3. Renseigner le titre (et facultativement la description), choisir *Public* ou *Secret*, puis **Épingle** et cliquer sur la carte, ou **Zone** et dessiner à main levée.
4. Pour corriger une annotation : crayon (titre, description) ou corbeille dans le panneau de droite ; glisser une épingle pour la déplacer.
5. Les joueurs cliquent sur l'icône carnet d'une annotation et écrivent directement dans leur journal. L'icône est colorée quand une note existe déjà.
