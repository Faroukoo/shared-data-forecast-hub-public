# Exploitation, import manuel et reprise

## Prérequis

Utiliser Node `22.22.x` et npm `11.15.x`. Les commandes normales sont hors ligne ; un accès distant n'est permis que lorsque `DATA_HUB_ALLOW_NETWORK=1` est présent. Toutes les sorties d'exécution sont écrites sous `.data-hub/`, répertoire ignoré par Git.

L'exécutable reste ponctuel et n'installe ni démon, ni cron local. En production, le workflow GitHub gardé restaure le dernier snapshot public valide, exécute les deux sources séquentiellement puis publie une nouvelle release seulement lorsqu'au moins une source a changé et que toutes les barrières sont franchies. La planification hebdomadaire reste inerte tant que le dépôt n'est pas public et que la variable `DATA_HUB_PRODUCTION_ENABLED` ne vaut pas exactement `true`.

## Contrôle sans téléchargement

```bash
DATA_HUB_ALLOW_NETWORK=1 npm run smoke:ckan -- --source hcp-ipc-2017-monthly
DATA_HUB_ALLOW_NETWORK=1 npm run smoke:ckan -- --source hcp-ipp-2018-monthly
```

Le smoke interroge le manifeste CKAN et effectue une requête `HEAD` bornée. Il ne crée ni artefact brut ni dataset publié. Vérifier l'identifiant source, le type XLSX, la taille, la présence éventuelle d'un `ETag` et d'un `Last-Modified`.

## Ingestion distante et preuve d'idempotence

```bash
DATA_HUB_ALLOW_NETWORK=1 npm run ingest -- --source hcp-ipc-2017-monthly
DATA_HUB_ALLOW_NETWORK=1 npm run ingest -- --source hcp-ipp-2018-monthly
```

Le premier passage valide doit retourner `published` ou `quarantined`. Répéter exactement la même commande : si les octets n'ont pas changé et que la publication précédente est complète, l'état doit être `no_change`, avec le même SHA-256 d'artefact et le même identifiant de dataset.

L'ordre du flux est fixe : découverte, téléchargement borné, archive immuable, recherche d'une publication complète, parsing, qualité, publication atomique et écriture du run terminal. Une interruption après archivage mais avant publication est reprise automatiquement au prochain lancement ; l'existence du seul artefact brut ne produit jamais `no_change`.

## Orchestration complète de production

```bash
DATA_HUB_ALLOW_NETWORK=1 npm run ingest:production -- \
  --data-dir .data-hub \
  --summary-file .data-hub/production-summary.json \
  --markdown-file .data-hub/production-summary.md \
  --code-sha "$(git rev-parse HEAD)"
```

Cette commande tente toutes les sources activées dans leur ordre stable, mais la décision globale devient `blocked` dès qu'une source échoue ou est mise en quarantaine. Une source en retard ou périmée reste visible sans modifier les valeurs officielles. Le workflow utilise les mêmes contrats et écrit ses fichiers intermédiaires dans le répertoire temporaire du runner.

## Import manuel contrôlé

```bash
npm run ingest -- import-file \
  --source hcp-ipc-2017-monthly \
  --file /chemin/controle/IPC.xlsx \
  --operator identifiant-admin \
  --period 2025-01
```

L'import manuel passe par le même stockage, le même parseur et les mêmes barrières de qualité que le téléchargement distant. L'opérateur et la période revendiquée sont inscrits dans le run.

Ne jamais corriger, recalculer ou renommer les cellules d'un classeur officiel avant import. Un classeur édité est une donnée dérivée : il devra être enregistré dans un lot ultérieur comme source interne distincte, avec son propriétaire, sa licence et ses propres contrôles.

## Inspection d'une quarantaine

Les runs sont sous `.data-hub/runs/` et leur rapport détaillé sous `.data-hub/quality/<run-id>.json`. Les artefacts et leurs manifestes sont respectivement sous `.data-hub/raw/` et `.data-hub/manifests/artifacts/`. Un run `quarantined` précise les nombres analysés, acceptés et mis en quarantaine ; le rapport qualité conserve chaque barrière échouée et empêche la création de `.data-hub/published/<dataset-id>/`.

Procédure :

1. conserver l'artefact et le run sans les modifier ;
2. relever les codes de barrière ou de parseur ;
3. vérifier le dataset CKAN, la licence et la structure du classeur auprès de la source officielle ;
4. corriger le connecteur ou le profil uniquement après qualification d'un changement réel ;
5. relancer la commande normale. Le digest existant sera réutilisé sans écrasement.

Une quarantaine n'autorise ni suppression de preuve, ni publication forcée, ni remplacement manuel du manifeste.

## Retard, panne fournisseur et fréquence manuelle

Interroger au maximum tous les 7 jours pour ces séries mensuelles. Après 60 jours sans nouvelle métadonnée, traiter `source_late` comme une alerte opérateur. Après 120 jours, `source_stale` doit rester visible dans les dashboards consommateurs.

Si le portail est indisponible, ne pas multiplier les tentatives ni utiliser automatiquement un miroir non officiel. Après vérification humaine, un fichier officiel reçu par un canal fiable peut être importé manuellement une fois ; le lancement distant hebdomadaire reprend ensuite. Chaque nouveau fichier manuel doit être contrôlé séparément et conserver son SHA-256.

## Sauvegarde, vérification et restauration

Préserver ensemble `.data-hub/raw`, `.data-hub/manifests`, `.data-hub/published`, `.data-hub/runs` et `.data-hub/quality`. Ne pas copier uniquement le dernier dataset : les artefacts et anciennes versions sont nécessaires à l'audit des révisions.

Vérifier l'intégralité de l'état avant création d'un snapshot ou après restauration :

```bash
npm run snapshot -- verify-state --data-dir .data-hub
```

Après téléchargement des trois assets exacts dans `/tmp/snapshot`, lire le nom de l'archive depuis l'index puis restaurer vers un chemin absent ou vide :

```bash
data_archive_name="$(node --input-type=module -e 'import fs from "node:fs"; process.stdout.write(JSON.parse(fs.readFileSync("/tmp/snapshot/snapshot-index.json", "utf8")).archive.name)')"
npm run snapshot -- restore \
  --archive "/tmp/snapshot/$data_archive_name" \
  --checksum "/tmp/snapshot/$data_archive_name.sha256" \
  --index /tmp/snapshot/snapshot-index.json \
  --target-data-dir /tmp/restored-data-hub
npm run snapshot -- verify-state --data-dir /tmp/restored-data-hub
```

L'opérateur obtient toujours le basename exact depuis `snapshot-index.json`. L'automatisation exécutable ne devine jamais le nom d'un asset. La restauration vérifie d'abord le sidecar, l'index, le digest distant et les entrées d'archive ; elle refuse les chemins absolus, les traversées, les liens et une cible non vide.

## Reprise après incident

1. Ne jamais modifier ni supprimer la dernière release valide.
2. Identifier le run et le rapport qualité en échec ; conserver le code d'incident et la provenance sans copier de donnée sensible dans une issue publique.
3. Si le fournisseur est indisponible ou si le schéma a changé, laisser l'exécution échouer fermée ; ne pas substituer automatiquement une autre source.
4. Télécharger anonymement la dernière release publique et effectuer la restauration ci-dessus dans un répertoire temporaire neuf.
5. Corriger le connecteur par tests, puis lancer manuellement le mode `restore-drill` avant un nouveau `refresh`.
6. Réactiver la planification uniquement après validation de l'état et résolution de l'incident de santé.

CasaNext, TournAxis, NSOGO et ERP Snack consommeront ce socle public par des connexions privées séparées. L'authentification, l'isolation des consommateurs et toutes les données métier restent hors du Data Hub public.
