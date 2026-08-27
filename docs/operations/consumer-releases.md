# Releases consommateurs ERP-Snack

## Périmètre et invariants

Une release `consumer-v1-*` est une projection publique en lecture seule d'une release source stable `data-*`. Elle contient exactement trois assets immuables :

- `consumer-index.json` ;
- `consumer-v1.json` ;
- `consumer-v1.json.sha256`.

Le workflow ne consomme jamais `latest`, un brouillon ou une prérelease `data-*`. Il restaure les trois assets source dans le répertoire temporaire du runner, vérifie l'état complet, reconstruit la projection puis vérifie le bundle avant toute décision de publication. Le mode `verify` n'a qu'un jeton `contents: read` et n'écrit aucune release.

## Création et vérification locales

Partir d'une release `data-*` déjà téléchargée, restaurée et validée selon `docs/operations/import-and-recovery.md`. Utiliser des répertoires neufs hors du checkout :

```bash
source_tag=data-20260827T095123Z-9d3b77bbfc0c
restored_data=/tmp/data-hub-consumer-source
snapshot_index=/tmp/data-hub-source-assets/snapshot-index.json
consumer_dir=/tmp/data-hub-consumer-bundle

npm run snapshot -- verify-state --data-dir "$restored_data"
npm run consumer -- create \
  --data-dir "$restored_data" \
  --snapshot-index "$snapshot_index" \
  --source-tag "$source_tag" \
  --output-dir "$consumer_dir" \
  --code-sha "$(git rev-parse HEAD)"
npm run consumer -- verify \
  --index "$consumer_dir/consumer-index.json" \
  --payload "$consumer_dir/consumer-v1.json" \
  --checksum "$consumer_dir/consumer-v1.json.sha256"
```

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
  -f mode=verify
```

Le run doit sélectionner exactement le tag fourni, restaurer la source et terminer par `verified: no release write requested` ou `no_change`. Une erreur de tag, d'asset, de digest, d'identité du snapshot ou de bundle arrête le run sans publication.

## Publication d'une candidate manuelle

Après revue du run `verify` et avec la même autorisation explicite d'écriture GitHub, créer uniquement une prérelease :

```bash
source_tag=data-20260827T095123Z-9d3b77bbfc0c
gh workflow run consumer-release.yml \
  --ref main \
  -f source_release_tag="$source_tag" \
  -f mode=publish-prerelease
```

Ce mode ne peut pas créer ou promouvoir une release stable. Le tag est dérivé de `consumer-index.json` sous la forme `consumer-v1-YYYYMMDDTHHMMSSZ-<12 premiers caractères du SHA-256 payload>`. Si une candidate portant exactement le même payload existe déjà, le résultat est `existing candidate in manual mode: no_change`. Si une stable exacte existe, le résultat est `existing stable release: no_change`.

## Contrôle d'intégrité d'une candidate ou d'une stable

Télécharger les trois assets dans un répertoire neuf et vérifier localement le sidecar, le contrat et l'identité source :

```bash
consumer_tag=consumer-v1-20260827T095123Z-dddddddddddd
verification_dir=/tmp/data-hub-consumer-verification
mkdir "$verification_dir"
gh release download "$consumer_tag" \
  --dir "$verification_dir" \
  --pattern consumer-index.json \
  --pattern consumer-v1.json \
  --pattern consumer-v1.json.sha256

(cd "$verification_dir" && shasum -a 256 -c consumer-v1.json.sha256)
npm run consumer -- verify \
  --index "$verification_dir/consumer-index.json" \
  --payload "$verification_dir/consumer-v1.json" \
  --checksum "$verification_dir/consumer-v1.json.sha256"
gh release view "$consumer_tag" --json tagName,name,isDraft,isPrerelease,publishedAt
```

La liste locale doit contenir exactement trois fichiers. Comparer `source_snapshot_tag`, `source_snapshot_id` et `payload.sha256` de l'index avec la source et le digest attendus. Le workflow refait lui-même le téléchargement et le hash de chaque asset après un upload ; une réussite de `gh release create` seule n'est pas une preuve.

## Politique de promotion stable

Le second portail d'autorisation est l'activation de la production consommateur. Ne définir la variable suivante qu'après autorisation explicite de production, revue d'une candidate et preuve d'intégrité :

```bash
gh variable set DATA_HUB_CONSUMER_PRODUCTION_ENABLED --body true
```

La publication automatique reste inerte tant que la variable ne vaut pas exactement `true`. Elle ne part qu'après la réussite du workflow `Verified public data refresh` sur la branche par défaut du même dépôt. Elle ignore les inputs manuels, sélectionne la plus récente release `data-*` publiée, stable et valide, puis reconstruit le bundle.

Si une candidate exacte existe, le workflow la retélécharge, vérifie ses trois digests et exécute `consumer verify` avant de basculer uniquement `prerelease` de `true` à `false`. Il ne modifie ni tag, ni titre, ni notes, ni target, ni asset, ni payload. Sans candidate et sans stable exacte, il crée directement une release stable immuable à partir du bundle vérifié. Une release `data-*` n'est jamais éditée.

Pour rendre les publications automatiques inertes après autorisation d'intervention externe :

```bash
gh variable set DATA_HUB_CONSUMER_PRODUCTION_ENABLED --body false
```

## `no_change`, fraîcheur et incidents

`no_change` signifie que le SHA-256 payload exact est déjà représenté par une stable, ou par une candidate lors d'un run manuel. Il ne signifie ni que la source vient d'être rafraîchie, ni qu'elle est saine, ni qu'elle est récente. Ne pas recréer, remplacer ou renommer la release existante.

Une source `stale` reste une observation historique intègre dont la fraîcheur dépasse la limite contractuelle. Son état, son âge et ses `warning_codes` restent visibles dans le payload consommateur. Elle peut fournir du contexte macro, mais ne doit jamais être interprétée comme un prix fournisseur actuel ou comme une autorisation de décision automatique. Une anomalie d'intégrité, de schéma ou de provenance bloque au contraire la projection ; ne pas affaiblir le validateur pour publier.

En cas d'échec, conserver le tag source, le SHA du code, les identifiants de run et le code d'erreur. Relancer d'abord le mode `verify` sur la même source après correction testée. Ne jamais utiliser `gh release edit`, `gh release upload --clobber`, supprimer une release ou modifier une release `data-*` pour réparer un bundle consommateur.

## Retour arrière consommateur

Les releases stables sont immuables : un retour arrière consiste à épingler l'application consommatrice sur un tag stable antérieur déjà vérifié, sans modifier ni supprimer la release courante. Avant de changer le pin du consommateur, télécharger et vérifier l'ancien tag :

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
