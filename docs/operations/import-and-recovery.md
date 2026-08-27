# Exploitation, import manuel et reprise

## Prérequis

Utiliser Node `22.22.x` et npm `11.15.x`. Les commandes normales sont hors ligne ; un accès distant n'est permis que lorsque `DATA_HUB_ALLOW_NETWORK=1` est présent. Toutes les sorties d'exécution sont écrites sous `.data-hub/`, répertoire ignoré par Git.

Le lot 1 est un exécutable ponctuel. Il n'installe ni démon, ni cron, ni workflow distant. La cadence recommandée est un lancement hebdomadaire supervisé tant qu'un stockage durable, des sauvegardes et un propriétaire de planification n'ont pas été validés.

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

## Sauvegarde et restauration

Pour ce lot local, préserver ensemble `.data-hub/raw`, `.data-hub/manifests`, `.data-hub/published` et `.data-hub/runs`. Une restauration est valide seulement si les checksums des artefacts et des JSONL publiés sont recalculés avec succès. Ne pas copier uniquement le dernier dataset : les artefacts et anciennes versions sont nécessaires à l'audit des révisions.

Avant une alimentation continue de CasaNext, TournAxis, NSOGO ou ERP Snack, il reste obligatoire de définir un stockage durable, une politique de sauvegarde/restauration testée, l'authentification du service, l'isolation des consommateurs, le propriétaire du scheduler et les alertes de santé source.
