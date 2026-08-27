# Shared Data Forecast Hub

Ce dépôt prépare, contrôle et distribue uniquement des séries macroéconomiques publiques qualifiées. Le premier périmètre couvre deux séries mensuelles officielles du Haut-Commissariat au Plan (HCP) : l'indice des prix à la consommation par ville et l'indice des prix à la production industrielle national.

Les achats, ventes, stocks, recettes, fournisseurs, marges, prix de plats, prévisions et autres données propres à une société sont interdits dans ce dépôt, dans son historique Git et dans ses releases. Ces données restent dans les environnements privés des applications consommatrices.

## Garanties du lot

- deux sources HCP explicitement qualifiées, sans découverte implicite de nouvelles sources ;
- conservation des octets officiels, de la provenance, des contrôles qualité et des checksums ;
- publication atomique et blocage global si une source échoue ou est mise en quarantaine ;
- snapshots complets, immuables, vérifiables et restaurables ;
- exécution hebdomadaire gardée, sans Supabase, Vercel, serveur résident, runner auto-hébergé ni artifact Actions ;
- absence de publication npm malgré la visibilité publique du dépôt (`private: true`).

Ce lot n'est ni une API publique, ni un moteur de prévision, ni un dashboard ERP. Il fournit le socle public et reproductible que les futurs connecteurs privés pourront consommer.

## Environnement et validation locale

Versions verrouillées : Node.js `22.22.3` (contrat `>=22.22.0 <23`) et npm `11.15.0`.

```bash
npm ci --no-audit --no-fund
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=high
```

Les commandes réseau sont refusées par défaut. L'autorisation doit être limitée à la commande concernée.

## Ingestion et orchestration

Contrôle léger puis ingestion d'une seule source :

```bash
DATA_HUB_ALLOW_NETWORK=1 npm run smoke:ckan -- --source hcp-ipc-2017-monthly
DATA_HUB_ALLOW_NETWORK=1 npm run ingest -- --source hcp-ipc-2017-monthly
```

L'autre identifiant autorisé est `hcp-ipp-2018-monthly`. L'orchestration de production traite séquentiellement toutes les sources activées et écrit un résumé machine ainsi qu'un résumé opérateur :

```bash
DATA_HUB_ALLOW_NETWORK=1 npm run ingest:production -- \
  --data-dir .data-hub \
  --summary-file .data-hub/production-summary.json \
  --markdown-file .data-hub/production-summary.md \
  --code-sha "$(git rev-parse HEAD)"
```

Vérification complète d'un état restauré ou produit :

```bash
npm run snapshot -- verify-state --data-dir .data-hub
```

Le détail des imports manuels, incidents et restaurations se trouve dans [la procédure d'exploitation](docs/operations/import-and-recovery.md).

## Téléchargement anonyme d'une release

Une release valide contient exactement `snapshot-index.json`, l'archive nommée par cet index et son fichier `.sha256`. Pour un dépôt public, ces trois assets sont téléchargeables sans jeton depuis la page de la dernière release ou via leurs `browser_download_url` retournées par :

```bash
curl --fail --silent --show-error --location \
  https://api.github.com/repos/Faroukoo/shared-data-forecast-hub-public/releases/latest
```

Il faut télécharger d'abord `snapshot-index.json`, lire exactement `archive.name`, puis télécharger cet asset et `${archive.name}.sha256`. La procédure de restauration ne devine jamais un nom d'asset.

## Droits

Les données publiées conservent leurs conditions de source et d'attribution décrites dans [NOTICE-DATA.md](NOTICE-DATA.md). Ce dépôt ne contient volontairement aucun fichier `LICENSE` pour le code : sa visibilité publique ne constitue donc pas une autorisation d'utiliser, modifier ou redistribuer le code.
