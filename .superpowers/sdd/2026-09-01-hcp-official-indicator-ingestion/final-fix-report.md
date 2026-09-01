# Final fix report — HCP ingestion fail-closed gaps

## Etat initial

- Worktree : `/Users/mob/Documents/ChatGPT/Module data/.worktrees/hcp-freshness-erp-coverage`
- Branche : `codex/hcp-freshness-erp-coverage`
- HEAD initial : `624f808f79719ef487079a6c79392f9026c731c4`
- HEAD initial de la rerevue round 2 : `17e54a92f71dbe36696381c9b14310291b9a2f39` (`fix: close HCP ingestion fail-closed gaps`).
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

### 5. Compteurs EOCD falsifies (rerevue round 2)

Regression ajoutee : sur le meme ZIP expansif, seuls les deux compteurs 16 bits de l'EOCD sont abaisses de 16 a 1. Un probe automatise confirme `EOCD = 1` tout en observant 16 en-tetes d'entrees locales. Un second fixture contient plus de 256 entrees locales avec le meme compteur EOCD falsifie.

RED : les deux tests echouaient avec `Missing expected rejection`. `unzipper.Open.buffer` construisait `directory.files` depuis le nombre d'enregistrements annonce par l'EOCD ; le preflight ne voyait donc ni l'entree expansive cachee ni les entrees au-dela de la premiere, et ExcelJS pouvait etre appele.

### 6. Feuille officielle sparse (rerevue round 2)

Regressions ajoutees : une seule cellule metier appendue en ligne 20 000, puis une cellule vide uniquement stylee a la meme hauteur. Le prototype `Worksheet.getRow` est instrumente et borne a moins de 100 appels.

RED : le contenu fonctionnel etait bien refuse, mais les deux probes echouaient sur la borne d'acces. `fixedLayoutErrors` et le parcours des observations appelaient `getRow` pour chaque index jusqu'a `rowCount`.

## Design des correctifs

### Couverture

`PreviousCoverage` conserve maintenant l'ensemble trie des cles naturelles publiees. `coverageShrank` verifie d'abord que chaque cle precedente est encore presente, puis conserve les comparaisons existantes de bornes, nombre de series et nombre de lieux. La comparaison semantique bidirectionnelle canonique n'a pas ete modifiee.

### Garantie ZIP et memoire

Le controle partage est interne a `@data-hub/parsers` dans `xlsx-zip-limits.ts` et n'est pas reexporte. Il utilise `unzipper@0.12.5`, dependance directe deja declaree dans `packages/parsers/package.json` et a la racine, deja verrouillee dans `package-lock.json`.

La garantie decrite au round 1 etait insuffisante : `Open.buffer` et `directory.files` dependaient du compteur EOCD. La rerevue a invalide l'affirmation d'exhaustivite du repertoire central ; le code ne l'utilise plus pour enumerer les entrees a controler.

Ordre des protections round 2 avant tout appel ExcelJS :

1. archive compressee limitee a 4 Mio ;
2. le buffer compresse deja borne alimente `unzipper.Parse({ forceStream: true })` ;
3. le parseur suit sequentiellement chaque en-tete local `0x04034b50`, independamment du nombre d'enregistrements annonce dans l'EOCD ;
4. chaque entree locale est comptee des qu'elle est emise, avec rejet a la 257e entree ;
5. les tailles non compressees des en-tetes locaux ne servent que de rejet anticipe, jamais de preuve d'exhaustivite ni de taille reelle ;
6. chaque entree est consommee sequentiellement par chunks, dont les octets reellement decomprimes sont comptes par entree et globalement, avec une limite de 32 Mio dans les deux cas ;
7. au premier depassement ou a toute erreur ZIP, l'entree courante, le parseur et la source sont detruits ; une limite conserve son erreur bornee, les autres erreurs deviennent `invalid_xlsx_container`.

Aucune entree n'est extraite sur disque ou materialisee en entier. Le seul input compresse est borne a 4 Mio ; les sorties passent par les chunks et la backpressure du stream. Le probe prouve, pour le fixture de regression, que `Parse` observe 16 entrees locales malgre `EOCD = 1`. Les deux parseurs rejettent le bomb avant ExcelJS avec `load = 0`, et le fixture a plus de 256 entrees est refuse par `xlsx_too_many_entries`. Cette preuve est bornee aux formats ZIP acceptes par `unzipper.Parse` ; un ZIP malforme ou non pris en charge est rejete fail-closed.

### Layout et fraicheur

Le parseur officiel exige maintenant l'en-tete exact `Date` et inspecte toutes les cellules non vides au-dela de `lastValueColumn`, y compris les lignes de preambule, l'en-tete et les lignes metier. Toute cellule appendue produit `unexpected_appended_cell` et aucune observation n'est acceptee.

Depuis le round 2, `fixedLayoutErrors` utilise `Worksheet.eachRow` puis `Row.eachCell` sans `includeEmpty` : seules les lignes et cellules materialisees avec une valeur sont visitees, les cellules vides seulement stylees restent permises, et une seule erreur appendue au maximum est enregistree. Le parcours des observations utilise egalement `eachRow`, sans boucle `1..rowCount` ni appel a `Worksheet.getRow` pour les index absents.

Le fallback de production mappe explicitement `future_period` vers `health_status = quarantined`, conserve `source_late` et `source_stale`, et rend donc la decision globale bloquante.

## GREEN et validations round 1

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

## GREEN et validations round 2

- RED cible EOCD : 0/2, deux `Missing expected rejection`.
- RED cible sparse : 0/2, deux echecs de la borne `getRow < 100`.
- GREEN cible EOCD + sparse : 4/4.
- Parseur officiel complet, probes EOCD/sparse inclus : 29/29.
- Parseur legacy : 8/8.
- Integration pertinente courante (connecteurs, parseurs, qualite, canonique, ingestion, production, contrats, registre et workflow) : 135/135.
- TypeScript strict : `npm run typecheck`, exit 0.
- ESLint : `npm run lint`, exit 0 apres le correctif local signale par le premier passage.
- `git diff --check` : aucun ecart.
- Scope : uniquement les deux parseurs partages, le fixture/test officiel et ce rapport ; aucun workflow, contrat, registre, lockfile ou dependance modifie.
- Scan de secrets sur le diff : aucun motif concret detecte.
- `npm test` complet et `npm run build` non lances conformement a la consigne de rerevue.

## Fichiers touches

Round 2 uniquement :

- `packages/parsers/src/hcp-official-indicator-workbook.ts`
- `packages/parsers/src/xlsx-zip-limits.ts`
- `tests/fixture-workbooks.ts`
- `tests/hcp-official-indicator-parser.test.ts`
- `.superpowers/sdd/2026-09-01-hcp-official-indicator-ingestion/final-fix-report.md`

Ensemble des deux rounds :

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
- Commit round 1 : `17e54a92f71dbe36696381c9b14310291b9a2f39` (`fix: close HCP ingestion fail-closed gaps`).
- Commit round 2 : le commit unique nomme `fix: harden XLSX streaming preflight` qui contient ce rapport. Son SHA exact est reporte au controleur apres creation ; un commit ne peut pas inclure son propre SHA dans son contenu sans en changer l'identifiant.
- Limites restantes : validations distante, CI, sources HCP reelles, publication, release et production non executees et non autorisees dans cette vague.
