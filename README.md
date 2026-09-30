# Carte partagée

Module autonome pour Foundry VTT v14. Il affiche un bouton fixe à droite de l'écran et ouvre une fenêtre contenant la carte et les annotations associées.

## Fonctionnalités

- Plusieurs cartes par monde, sous forme d'onglets. Le MJ les crée, les renomme et les supprime.
- Le MJ importe une image depuis son ordinateur ou indique un chemin d'image accessible à Foundry.
- Le MJ place des épingles et dessine des zones à main levée. Titre et description se saisissent avant de poser, et restent modifiables ensuite depuis le panneau (crayon). Les épingles se déplacent par glisser-déposer avec l'outil sélection.
- Les cartes et annotations sont partagées avec tout le monde et se mettent à jour en direct.
- Chaque joueur peut prendre des notes personnelles sur une annotation. Elles vont dans son propre journal **Notes de <joueur>** (dossier *Carte partagée*), une page par annotation. Seuls le joueur et le MJ peuvent les lire ; elles ne s'affichent pas sur la carte.

## Installation locale

Copiez le dossier `carte-partagee` dans `Data/modules/`, puis activez **Carte partagée** dans les paramètres de modules du monde.

Installation depuis Foundry : **Modules complémentaires** > **Installer un module**, puis collez le manifeste :

```text
https://github.com/tomjdr4-hub/carte-partagee/releases/latest/download/module.json
```

### Droits

Aucune permission Foundry à modifier : quand le MJ se connecte, le module crée pour chaque joueur un journal dont il est propriétaire, et les notes y sont ajoutées comme pages. Un joueur créé pendant que le MJ est connecté reçoit son journal immédiatement ; sinon, à la prochaine connexion du MJ. L'import d'image écrit dans `Data/worlds/<monde>/carte-partagee/`.

## Utilisation

1. Ouvrir la carte avec le bouton à droite.
2. En tant que MJ, cliquer sur **+ Carte**, la renommer si besoin, puis importer une image.
3. Renseigner le titre (et facultativement la description), puis choisir **Épingle** et cliquer sur la carte, ou choisir **Zone** et dessiner à main levée.
4. Pour corriger une annotation : crayon (titre, description) ou corbeille dans le panneau de droite ; glisser une épingle pour la déplacer.
5. Les joueurs écrivent leur note sous l'annotation souhaitée et cliquent sur **Ajouter à mes notes**. Le bouton livre ouvre directement la page correspondante dans leur journal.
