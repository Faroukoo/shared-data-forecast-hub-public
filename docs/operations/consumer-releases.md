# Releases consommateurs ERP-Snack

## Périmètre et invariants

Une release `consumer-v1-*` ou `consumer-v2-*` est une projection publique en lecture seule d'une release source stable `data-*`. Chaque famille contient exactement trois assets immuables :

- `consumer-index.json` ;
- `consumer-v1.json` et `consumer-v1.json.sha256` pour v1 ;
- `consumer-v2.json` et `consumer-v2.json.sha256` pour v2.

Une release ne mélange jamais les noms v1 et v2. Le contrat v1 reste le défaut du CLI et la seule famille publiée ou promue automatiquement. Le contrat v2 est limité aux vérifications et aux candidates manuelles tant qu'une porte de promotion stable séparée n'a pas été conçue, revue et explicitement autorisée.

Le workflow ne consomme jamais `latest`, un brouillon ou une prérelease `data-*`. Il restaure les trois assets source dans le répertoire temporaire du runner, vérifie l'état complet, reconstruit la projection puis vérifie le bundle avant toute décision de publication. Le mode `verify` n'a qu'un jeton `contents: read` et n'écrit aucune release.

Le tag `data-*` exact de la release publique sélectionnée est la métadonnée source autoritaire. Son suffixe de 12 caractères doit correspondre au début du `snapshot_id`, mais son horodatage de publication n'est pas reconstruit depuis `snapshot-index.json.created_at`, qui peut être antérieur de quelques secondes.

## Création et vérification locales

Partir d'une release `data-*` déjà téléchargée, restaurée et validée selon `docs/operations/import-and-recovery.md`. Utiliser des répertoires neufs hors du checkout :

```bash
source_tag=data-20260827T095123Z-9d3b77bbfc0c
restored_data=/tmp/data-hub-consumer-source
snapshot_index=/tmp/data-hub-source-assets/snapshot-index.json
consumer_dir=/tmp/data-hub-consumer-bundle
contract_version=v2

npm run snapshot -- verify-state --data-dir "$restored_data"
npm run consumer -- create \
  --data-dir "$restored_data" \
  --snapshot-index "$snapshot_index" \
  --source-tag "$source_tag" \
  --output-dir "$consumer_dir" \
  --code-sha "$(git rev-parse HEAD)" \
  --contract-version "$contract_version"
npm run consumer -- verify \
  --index "$consumer_dir/consumer-index.json" \
  --payload "$consumer_dir/consumer-v2.json" \
  --checksum "$consumer_dir/consumer-v2.json.sha256"
```

Omettre `--contract-version` conserve strictement la création v1 historique. Pour v2, l'option explicite est obligatoire dans les procédures opérateur afin de rendre le changement de contrat visible.

`consumer create` refuse un répertoire de sortie non vide. Ne pas supprimer ou réutiliser un ancien bundle pour contourner ce garde-fou. Contrôler ensuite que les seuls basenames présents sont les trois noms contractuels :

```bash
find "$consumer_dir" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort
```

## Vérification distante sans publication

Le premier portail d'autorisation est tout dispatch de workflow GitHub. Même si le mode `verify` reste sans écriture de release, ne lancer la commande suivante qu'après autorisation explicite d'une exécution GitHub externe :

```bash
source_tag=data-20260827T095123Z-9d3b77bbfc0c
gh workflow run consumer-release.yml \
  --ref main \
  -f source_release_tag="$source_tag" \
  -f contract_version=v2 \
  -f mode=verify
```

Le run doit sélectionner exactement le tag et la version fournis, restaurer la source et terminer par `verified: no release write requested` ou `no_change`. Une erreur de version, tag, asset, digest, identité du snapshot ou bundle arrête le run sans publication. Utiliser `contract_version=v1` pour vérifier explicitement l'ancien contrat ; l'input manuel vaut v1 par défaut pour compatibilité.

## Publication d'une candidate manuelle

Après revue du run `verify` et avec la même autorisation explicite d'écriture GitHub, créer uniquement une prérelease :

```bash
source_tag=data-20260827T095123Z-9d3b77bbfc0c
gh workflow run consumer-release.yml \
  --ref main \
  -f source_release_tag="$source_tag" \
  -f contract_version=v2 \
  -f mode=publish-prerelease
```

Ce mode ne peut pas créer ou promouvoir une release stable. Le job de publication refuse aussi tout dispatch dont la ref n'est pas exactement `refs/heads/<branche par défaut>` ; `--ref main` est donc une barrière appliquée par le workflow et pas seulement une convention opérateur. Le tag est dérivé de `consumer-index.json` sous la forme `consumer-v2-YYYYMMDDTHHMMSSZ-<12 premiers caractères du SHA-256 payload>`. Si une candidate portant exactement le même payload existe déjà, le résultat est `existing candidate in manual mode: no_change`. Une candidate défectueuse n'est jamais éditée, remplacée ou supprimée : corriger la source ou le code, refaire `verify`, puis produire un nouveau tag immuable.

## Contrôle d'intégrité d'une candidate ou d'une stable

Télécharger les trois assets dans un répertoire neuf et vérifier localement le sidecar, le contrat et l'identité source :

```bash
consumer_tag=consumer-v2-20260827T095123Z-dddddddddddd
verification_dir=/tmp/data-hub-consumer-verification
mkdir "$verification_dir"
gh release download "$consumer_tag" \
  --dir "$verification_dir" \
  --pattern consumer-index.json \
  --pattern consumer-v2.json \
  --pattern consumer-v2.json.sha256

(cd "$verification_dir" && shasum -a 256 -c consumer-v2.json.sha256)
npm run consumer -- verify \
  --index "$verification_dir/consumer-index.json" \
  --payload "$verification_dir/consumer-v2.json" \
  --checksum "$verification_dir/consumer-v2.json.sha256"
gh release view "$consumer_tag" --json tagName,name,isDraft,isPrerelease,publishedAt
```

La liste locale doit contenir exactement trois fichiers. Comparer `source_snapshot_tag`, `source_snapshot_id` et `payload.sha256` de l'index avec la source et le digest attendus. Le workflow refait lui-même le téléchargement et le hash de chaque asset après un upload ; une réussite de `gh release create` seule n'est pas une preuve.

## Test ERP épinglé sur une candidate v2

Après validation d'intégrité, tester ERP-Snack dans un environnement isolé en épinglant exactement le tag `consumer-v2-*` contrôlé. Désactiver toute découverte automatique pour ce test : le client doit télécharger les trois assets de ce tag précis, valider le schéma v2 et ses digests, puis exposer les quinze tuples attendus sans interpréter la cellule nationale fraîche comme une donnée locale fraîche. Conserver comme preuve le tag, le SHA du code ERP, le résultat des tests de compatibilité et le retour explicite à son pin v1 initial.

Ce test épinglé n'active pas v2 en production et n'autorise pas une promotion stable. La découverte automatique reste sur le dernier v1 stable compatible.

## Politique de promotion stable

Le second portail d'autorisation existant concerne uniquement la production automatique v1. Ne définir la variable suivante qu'après autorisation explicite de production, revue d'une candidate v1 et preuve d'intégrité :

```bash
gh variable set DATA_HUB_CONSUMER_PRODUCTION_ENABLED --body true
```

La publication automatique reste inerte tant que la variable ne vaut pas exactement `true`. Elle ne part qu'après la réussite du workflow `Verified public data refresh` sur la branche par défaut du même dépôt, lui-même déclenché par `schedule` ou `workflow_dispatch` ; tout autre type d'événement producteur est refusé. Elle ignore les inputs manuels, force `contract_version=v1`, sélectionne la plus récente release `data-*` publiée, stable et valide, puis reconstruit le bundle.

Si une candidate v1 exacte existe, le workflow la retélécharge, vérifie ses trois digests, exécute `consumer verify`, exige les notes déterministes exactes et vérifie que `consumer-index.json.code_sha` est égal au `target_commitish` de la release avant de basculer uniquement `prerelease` de `true` à `false`. Il ne modifie ni tag, ni titre, ni notes, ni target, ni asset, ni payload. Sans candidate et sans stable v1 exacte, il crée directement une release v1 stable immuable à partir du bundle vérifié. Une release `data-*` n'est jamais éditée.

La promotion stable v2 est une évolution future séparée. Elle devra disposer de son propre plan, de tests ERP épinglés concluants, d'une revue et d'une autorisation explicite ; le workflow actuel ne promeut et ne crée automatiquement aucune stable v2.

Pour rendre les publications automatiques inertes après autorisation d'intervention externe :

```bash
gh variable set DATA_HUB_CONSUMER_PRODUCTION_ENABLED --body false
```

## `no_change`, fraîcheur et incidents

`no_change` signifie que le SHA-256 payload exact est déjà représenté par une stable v1, ou par une candidate de la même version lors d'un run manuel. Il ne signifie ni que la source vient d'être rafraîchie, ni qu'elle est saine, ni qu'elle est récente. Ne pas recréer, remplacer ou renommer la release existante.

Une source `stale` reste une observation historique intègre dont la fraîcheur dépasse la limite contractuelle. Son état, son âge et ses `warning_codes` restent visibles dans le payload consommateur. Elle peut fournir du contexte macro, mais ne doit jamais être interprétée comme un prix fournisseur actuel ou comme une autorisation de décision automatique. Une anomalie d'intégrité, de schéma ou de provenance bloque au contraire la projection ; ne pas affaiblir le validateur pour publier.

En cas d'échec, conserver le tag source, le SHA du code, les identifiants de run et le code d'erreur. Relancer d'abord le mode `verify` sur la même source après correction testée. Ne jamais utiliser `gh release edit`, `gh release upload --clobber`, supprimer une release ou modifier une release `data-*` pour réparer un bundle consommateur.

## Retour arrière consommateur

Les releases et candidates sont immuables. Après un test v2 non concluant, le retour arrière immédiat consiste à réépingler ERP-Snack sur son tag v1 stable antérieur déjà vérifié, sans modifier ni supprimer la candidate v2. Avant de changer le pin du consommateur, télécharger et vérifier le tag v1 :

```bash
rollback_tag=consumer-v1-20260820T051700Z-aaaaaaaaaaaa
rollback_dir=/tmp/data-hub-consumer-rollback
mkdir "$rollback_dir"
gh release download "$rollback_tag" \
  --dir "$rollback_dir" \
  --pattern consumer-index.json \
  --pattern consumer-v1.json \
  --pattern consumer-v1.json.sha256
(cd "$rollback_dir" && shasum -a 256 -c consumer-v1.json.sha256)
npm run consumer -- verify \
  --index "$rollback_dir/consumer-index.json" \
  --payload "$rollback_dir/consumer-v1.json" \
  --checksum "$rollback_dir/consumer-v1.json.sha256"
```

Le changement du pin dans ERP-Snack est une écriture externe distincte et requiert sa propre autorisation. Documenter l'ancien et le nouveau tag, la cause, l'heure et la preuve de vérification. Le Data Hub conserve toutes les versions afin que le retour à la release plus récente reste possible.
