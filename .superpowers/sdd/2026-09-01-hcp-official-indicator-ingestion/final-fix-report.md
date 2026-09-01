# Final fix report — HCP ingestion fail-closed gaps

## Etat initial

- Worktree : `/Users/mob/Documents/ChatGPT/Module data/.worktrees/hcp-freshness-erp-coverage`
- Branche : `codex/hcp-freshness-erp-coverage`
- HEAD initial : `624f808f79719ef487079a6c79392f9026c731c4`
- Etat Git initial : propre, sur une branche nommee dans un worktree lie.
- Contraintes respectees : aucun reseau, workflow, push, release, migration, deploiement, service, conteneur, sous-agent ou nouvelle dependance.

## RED observes

### 1. Couverture granulaire

Regression ajoutee : deux ingestions officielles successives, puis suppression de la cellule interieure `D25` sans modifier les bornes temporelles ni le nombre de series ou de lieux.

RED : `Expected 'quarantined', actual 'published'`. La qualite ne recevait que les bornes, comptes et libelles ; elle ne pouvait pas prouver la preservation de chaque cle naturelle historique.

### 2. ZIP bomb avec tailles forgees

Regression ajoutee : un XLSX fortement compressible dont les tailles non compressees des en-tetes ZIP locaux et centraux sont forcees a `1`, alors que la sortie reelle depasse 32 Mio. Le test exerce les deux parseurs et remplace `workbook.xlsx.load` par un mock compteur.

RED : `Missing expected rejection`. Le preflight additionnait uniquement `uncompressedSize`, valeur declaree par l'archive.

### 3. Layout officiel appendu

Regressions ajoutees : colonne metier appendue apres la borne fixe, en-tete `Date` remplace par `Periode`, et reordonnancement du meme ensemble exact de libelles.

RED : la colonne appendue et l'en-tete change n'ajoutaient aucune erreur de parseur. Le reordonnancement etait deja refuse par `label_position_mismatch` et dispose maintenant d'une regression explicite.

### 4. `future_period` sur exact-byte `no_change`

Regression ajoutee : artefact exact deja lie au manifest, `last_period_end = 2026-09-30` et `now = 2026-08-26T12:00:00.000Z`.

RED : `Expected 'blocked', actual 'no_change'`. Le fallback convertissait tout code de fraicheur non nul autre que `source_stale` en `late`.

## Design des correctifs

### Couverture

`PreviousCoverage` conserve maintenant l'ensemble trie des cles naturelles publiees. `coverageShrank` verifie d'abord que chaque cle precedente est encore presente, puis conserve les comparaisons existantes de bornes, nombre de series et nombre de lieux. La comparaison semantique bidirectionnelle canonique n'a pas ete modifiee.

### Garantie ZIP et memoire

Le controle partage est interne a `@data-hub/parsers` dans `xlsx-zip-limits.ts` et n'est pas reexporte. Il utilise `unzipper@0.12.5`, dependance directe deja declaree dans `packages/parsers/package.json` et a la racine, deja verrouillee dans `package-lock.json`.

Ordre des protections avant tout appel ExcelJS :

1. archive compressee limitee a 4 Mio ;
2. repertoire central ouvert depuis ce buffer deja borne ;
3. nombre d'entrees limite a 256 ;
4. sommes declarees conservees comme rejet anticipe ;
5. chaque entree est decompressee sequentiellement avec `file.stream()` et consommee par iteration asynchrone ;
6. les octets reels sont comptes par entree et globalement, avec une limite de 32 Mio dans les deux cas ;
7. au premier chunk qui depasse une limite, le stream est detruit et `xlsx_uncompressed_too_large` est leve.

Aucune entree n'est extraite sur disque ou materialisee en entier. La memoire est bornee par le buffer ZIP de 4 Mio, les metadonnees de 256 entrees au plus et les chunks soumis a la backpressure du stream. Le test forge prouve que les deux parseurs rejettent avec zero appel a `workbook.xlsx.load`.

### Layout et fraicheur

Le parseur officiel exige maintenant l'en-tete exact `Date` et inspecte toutes les cellules non vides au-dela de `lastValueColumn`, y compris les lignes de preambule, l'en-tete et les lignes metier. Toute cellule appendue produit `unexpected_appended_cell` et aucune observation n'est acceptee.

Le fallback de production mappe explicitement `future_period` vers `health_status = quarantined`, conserve `source_late` et `source_stale`, et rend donc la decision globale bloquante.

## GREEN et validations

- Couverture ingestion et qualite ciblee : 4/4.
- Parseurs legacy et officiel : 33/33.
- Production, contrats et registre : 25/25.
- Integration pertinente (connecteurs, parseurs, qualite, canonique, ingestion, production, registre, workflow) : 131/131.
- Regression ZIP forge rejouee apres correction lint : 1/1, zero appel ExcelJS.
- TypeScript strict : `npm run typecheck`, exit 0.
- ESLint : `npm run lint`, exit 0 apres correction du mock de test.
- `git diff --check` : aucun ecart.
- Scan de secrets sur le diff : aucun motif concret detecte.
- `npm test` complet et `npm run build` non relances conformement a la consigne ; le controleur les execute une seule fois apres rerevue.

## Fichiers touches

- `apps/ingest-cli/src/run-ingestion.ts`
- `apps/ingest-cli/src/run-production.ts`
- `packages/parsers/src/hcp-index-workbook.ts`
- `packages/parsers/src/hcp-official-indicator-workbook.ts`
- `packages/parsers/src/xlsx-zip-limits.ts`
- `packages/quality/src/evaluate-quality.ts`
- `tests/fixture-workbooks.ts`
- `tests/hcp-official-indicator-parser.test.ts`
- `tests/ingestion-flow.test.ts`
- `tests/production-run.test.ts`
- `tests/quality.test.ts`
- `tests/source-registry.test.ts`
- `.superpowers/sdd/2026-09-01-hcp-official-indicator-ingestion/final-fix-report.md`

Aucun workflow, contrat de snapshot, documentation operateur, lockfile ou dependance n'a ete modifie.

## SHA et limites

- SHA initial : `624f808f79719ef487079a6c79392f9026c731c4`.
- Commit de livraison : le commit unique nomme `fix: close HCP ingestion fail-closed gaps` qui contient ce rapport. Son SHA exact est reporte au controleur apres creation ; un commit ne peut pas inclure son propre SHA dans son contenu sans en changer l'identifiant.
- Limites restantes : validations distante, CI, sources HCP reelles, publication, release et production non executees et non autorisees dans cette vague.
