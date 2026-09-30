# Carte partagée

Module autonome pour Foundry VTT v14. Il affiche un bouton fixe à droite de l'écran et ouvre une fenêtre contenant la carte et les annotations associées.

## Fonctionnalités

- Le MJ importe une image depuis son ordinateur ou indique un chemin d'image accessible à Foundry.
- Le MJ place des épingles et dessine des zones à main levée. Titre et description sont saisis dans la barre d'outils avant de dessiner.
- Les annotations et le chemin de l'image sont partagés avec le monde via un réglage Foundry.
- Les joueurs ajoutent un commentaire à chaque annotation. Chaque commentaire est une véritable entrée de journal Foundry, visible aux joueurs et au MJ, et reliée à l'annotation par un flag du module.

## Installation locale

Copiez le dossier `carte-partagee` dans `Data/modules/`, puis activez **Carte partagée** dans les paramètres de modules du monde. L'import d'image écrit dans `Data/worlds/<monde>/`; le serveur Foundry doit pouvoir y écrire.

Installation depuis Foundry : **Modules complémentaires** > **Installer un module**, puis collez le manifeste :

```text
https://github.com/tomjdr4-hub/carte-partagee/releases/latest/download/module.json
```

Les joueurs doivent disposer de la permission Foundry de créer des entrées de journal. Les commentaires existants restent accessibles dans la sidebar Journaux et dans le panneau de la carte.

## Utilisation

1. Ouvrir la carte avec le bouton à droite.
2. En tant que MJ, importer une image.
3. Renseigner le titre (et facultativement la description), puis choisir **Épingle** et cliquer sur la carte, ou choisir **Zone** et dessiner à main levée.
4. Les joueurs écrivent leur commentaire sous l'annotation souhaitée et cliquent sur **Ajouter au journal**.