# Data Hub HCP frais et fiabilite matiere ERP-Snack

Statut : architecture approuvee le 2026-09-01. Ce document autorise la preparation et l'implementation locale par lots. Il n'autorise ni fusion, ni publication de release, ni migration Supabase distante, ni deploiement Vercel ou production.

## 1. Resultat attendu

Le programme doit renforcer le module partage `shared-data-forecast-hub-public` sans casser ses releases publiques existantes, puis permettre a ERP-Snack de distinguer clairement une marge exploitable d'une marge calculee sur des donnees matiere incompletes.

Le resultat cible est compose de trois livrables independants et reversibles :

1. cinq nouvelles sources HCP officielles et recentes, lues chaque semaine depuis les classeurs lies par le HCP ;
2. un contrat consommateur ERP-Snack v2 qui combine une tendance alimentaire nationale recente et les series detaillees historiques existantes, sans inventer de donnees locales ;
3. un indicateur compact de fiabilite des couts matiere dans le dashboard ERP-Snack, construit uniquement a partir des ventes eligibles, recettes, rendements, formats d'achat, receptions et mouvements FIFO existants.

Le Data Hub reste un module d'observation et de provenance. Les recommandations de prix, portions, achats ou retrait de plats restent dans l'ERP prive et devront etre soumises a validation humaine.

## 2. Constats confirmes

### 2.1 Sources historiques actuelles

Les deux sources CKAN existantes restent qualifiees et ne sont ni remplacees ni modifiees :

- `hcp-ipc-2017-monthly`, dataset `0ebb73ec-1f04-4854-b73e-a7868b0b18b0`, contient l'IPC national et par ville utile a ERP-Snack ;
- `hcp-ipp-2018-monthly`, dataset `59a68619-4bd8-4086-8bea-5a0e4757b4d8`, contient l'IPPI utile a CasaNext et TournAxis.

Leur ressource machine est datee du 2025-02-06. Elles restent donc une base historique detaillee, mais ne doivent pas etre presentees comme une observation fraiche de 2026.

### 2.2 Sources HCP officielles recentes

Les pages indicateurs officielles du HCP pointent vers deux classeurs Google Sheets publics :

- IPC : classeur `1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8`, groupes `0` et `1240277578` ;
- IPPI : classeur `1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro`, groupes `1228710067`, `53126080` et `872756965`.

Au 2026-09-01, les cinq feuilles contiennent juillet 2026. L'IPC remonte a janvier 2017 et l'IPPI a janvier 2019. Les exports XLSX ne fournissent pas de `Last-Modified` ou d'`ETag` stable. Deux exports semantiquement identiques peuvent avoir des SHA-256 differents a cause du conditionnement XLSX ; l'identite binaire ne suffit donc pas pour decider qu'un dataset a change.

### 2.3 Licence et attribution

Les conditions generales du HCP autorisent le telechargement et la reutilisation, y compris commerciale, sous CC BY 4.0, sous reserve d'attribution et d'integrite. Les nouvelles sources portent donc :

- `licence.id = "CC-BY-4.0"` ;
- `licence.evidence_url = "https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html"` ;
- `permits_internal_derived_use = true` ;
- `permits_redistribution = true`.

La page indicateur officielle reste l'URL d'autorite de chaque famille. Les octets officiels sont archives avant analyse et aucune valeur n'est corrigee silencieusement.

### 2.4 ERP-Snack

ERP-Snack dispose deja des objets metier necessaires : formats d'achat, rendements, receptions et lignes de reception, reglements fournisseurs, lots, mouvements FIFO, recettes et cas de revue. Le calcul FIFO bloque deja la marge lorsque la valorisation est incomplete. Le probleme prioritaire n'est donc pas une nouvelle formule de marge, mais la couverture insuffisante des donnees d'entree.

La reconstruction de juillet ou aout ne doit jamais etre automatique. Elle n'est autorisee que depuis des tickets, factures ou quantites reelles et fera l'objet d'un flux de reprise separe.

## 3. Principes non negociables

1. Conserver les deux sources CKAN et toutes les releases `data-*` et `consumer-v1-*` existantes immuables.
2. Ajouter les sources recentes en voie parallele ; ne jamais extrapoler un indice de ville depuis un indice national.
3. Refuser une nouvelle etiquette, une structure de feuille inconnue, une valeur ambigue ou une couverture qui se contracte.
4. Evaluer la fraicheur depuis la derniere `period_end` analysee, jamais depuis une date HTTP absente ou un horodatage d'emballage XLSX.
5. Archiver les octets telecharges dans le workspace du run avant analyse. Une variation binaire sans variation semantique ne publie ni nouveau dataset ni nouveau snapshot public.
6. Garder le contrat consommateur v1 lisible et publiable tel quel ; le v2 utilise des noms de fichiers, schemas et tags distincts.
7. Ne publier aucune donnee transactionnelle ERP dans le depot public.
8. Garder le dashboard simple : un seul resume compact de fiabilite, avec actions exactes, sans nouvelle grille de cartes.
9. Ne jamais afficher une marge, un cout theorique ou une trajectoire comme fiable si les donnees requises sont incompletes.
10. Toute recommandation metier reste explicable, reversible et soumise a validation du patron ou de l'admin.

## 4. Architecture Data Hub

### 4.1 Connecteur XLSX Google Sheets borne

Le contrat `SourceDefinition` recoit un nouveau connecteur discriminant :

```ts
type GoogleSheetsXlsxConnector = {
  kind: "google-sheets-xlsx";
  spreadsheet_id: string;
  sheet_gid: string;
};
```

`spreadsheet_id` accepte uniquement `[A-Za-z0-9_-]+` et `sheet_gid` uniquement des chiffres. L'URL est construite par le connecteur :

```text
https://docs.google.com/spreadsheets/d/<spreadsheet_id>/export?format=xlsx&gid=<sheet_gid>
```

La politique reseau autorise l'hote initial exact `docs.google.com`, puis uniquement des redirections HTTPS dont l'hote respecte `doc-<segments>-sheets.googleusercontent.com`. Les identifiants dans l'URL sont refuses, le nombre de redirections est limite a trois, le delai reste de quinze secondes et la taille maximale a 4 Mio. Le fichier doit commencer par la signature ZIP attendue d'un XLSX.

Ce connecteur ne devient pas un telechargeur URL arbitraire. La politique CKAN existante reste inchangee.

### 4.2 Parseur HCP officiel specialise

Un nouveau parseur `hcp-official-indicator-workbook` est ajoute avec cinq profils fermes :

- `ipc-2017-official-g1` ;
- `ipc-2017-official-g2` ;
- `ippi-2018-official-g1` ;
- `ippi-2018-official-g2` ;
- `ippi-2018-official-g3`.

Le parseur CKAN `hcp-index-workbook` reste intact. Le nouveau parseur lit uniquement la premiere feuille, exige l'en-tete `Mois`, les lignes et colonnes attendues ainsi que le pied de source HCP obligatoire. Le texte officiel du pied est compare apres retrait des seuls espaces peripheriques de mise en page presents dans certains exports. Les lignes IPC utilisent `AAAA/MM`; les lignes IPPI peuvent contenir une date Excel ou cette chaine stricte, comme dans les exports officiels observes. Le parseur accepte les cellules numeriques finies et traite `-` comme valeur manquante autorisee uniquement pour `Cokefaction et raffinage`. Une cellule vide ou toute autre cellule non numerique dans une ligne publiee est bloquante.

Les etiquettes autorisees et leurs cles sont exactes :

| Profil | Etiquette officielle | Cle canonique |
|---|---|---|
| IPC g1 | Produits alimentaires et boissons non alcoolisees | `hcp.ipc2017.01` |
| IPC g1 | Boissons alcoolisees, tabac et stupefiants | `hcp.ipc2017.02` |
| IPC g1 | Articles d'habillement et chaussures | `hcp.ipc2017.03` |
| IPC g1 | Logement, eau, gaz, electricite et autres combustibles | `hcp.ipc2017.04` |
| IPC g1 | Meubles, articles de menage et entretien courant du foyer | `hcp.ipc2017.05` |
| IPC g1 | Sante | `hcp.ipc2017.06` |
| IPC g2 | Transports | `hcp.ipc2017.07` |
| IPC g2 | Communications | `hcp.ipc2017.08` |
| IPC g2 | Loisirs et culture | `hcp.ipc2017.09` |
| IPC g2 | Enseignement | `hcp.ipc2017.10` |
| IPC g2 | Restaurants et hotels | `hcp.ipc2017.11` |
| IPC g2 | Biens et services divers | `hcp.ipc2017.12` |

Les accents et apostrophes des etiquettes reelles sont conserves dans `source_series_label`; la table ci-dessus decrit les correspondances semantiques. Les profils IPPI utilisent la meme fonction de slug deja eprouvee par le parseur CKAN pour produire des cles `hcp.ipp2018.<slug>`, mais uniquement apres correspondance avec leur liste fermee de 23 etiquettes auditees. Une etiquette inconnue produit `parser_errors` et met le run en quarantaine.

Toutes les observations nouvelles sont nationales : `geography_type = "country"`, `location_key = "ma"`, unite `index`, frequence mensuelle, base 2017 pour IPC et 2018 pour IPPI.

### 4.3 Registre des cinq sources

Le registre ajoute :

| Source | Feuille | Page officielle |
|---|---:|---|
| `hcp-ipc-2017-official-g1-monthly` | `0` | `https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html` |
| `hcp-ipc-2017-official-g2-monthly` | `1240277578` | meme page IPC |
| `hcp-ippi-2018-official-g1-monthly` | `1228710067` | `https://www.hcp.ma/Indices-des-prix-a-la-production-industrielle-IPPI_r624.html` |
| `hcp-ippi-2018-official-g2-monthly` | `53126080` | meme page IPPI |
| `hcp-ippi-2018-official-g3-monthly` | `872756965` | meme page IPPI |

Elles sont `official`, `api`, actives, nationales, mensuelles, interrogees tous les sept jours, avec avertissement apres 60 jours et expiration apres 120 jours. Le workflow existant execute les sept sources sequentiellement ; aucun nouveau serveur, cron Vercel, base ou ressource payante n'est ajoute.

### 4.4 Fraicheur par periode publiee

La qualite expose deux chemins explicites :

- `assessFreshness` conserve la date distante HTTP pour les connecteurs qui en disposent ;
- `assessPeriodFreshness` calcule l'age calendaire depuis la derniere `period_end` du dataset analyse.

Le rapport de qualite reste la source de verite. Pour les feuilles HCP, `source_late` et `source_stale` viennent uniquement de `assessPeriodFreshness`. Le resume de production d'un run `no_change` reutilise le dernier rapport qualite valide et la derniere periode du manifest publie ; il ne retombe pas sur une date HTTP absente.

### 4.5 Non-changement semantique

Le module canonique expose une fonction pure qui compare les candidats avec la revision courante selon exactement les champs de `semanticEvidence` deja utilises par `resolveRevisions` : cle naturelle, serie, etiquette, periode, frequence, valeur, unite, devise, facteur d'echelle, geographie, lieu et source.

Apres telechargement, archivage local, analyse et qualite :

- si l'artefact SHA-256 est deja publie, le chemin binaire `no_change` existant reste utilise ;
- si le SHA-256 est nouveau mais toutes les preuves semantiques sont identiques, le run termine `no_change`, reference le dataset courant et ne publie ni dataset ni snapshot ;
- si au moins une preuve semantique change, `publishDataset` applique les revisions existantes et cree un dataset immuable ;
- si le parseur ou la qualite echoue, aucun dataset n'est publie.

La provenance du nouvel emballage XLSX reste visible dans le run et le rapport de qualite du workspace d'execution. La release publique durable ne grossit pas pour un simple changement d'emballage.

## 5. Contrat consommateur ERP-Snack v2

### 5.1 Isolation du v1

Le v2 est une famille parallele :

- contrat et profil `erp-snack-observation-v2` ;
- payload `consumer-v2.json` ;
- sidecar `consumer-v2.json.sha256` ;
- tags `consumer-v2-YYYYMMDDTHHMMSSZ-<12-hex>`.

Les schemas, fichiers, tags et releases v1 restent acceptes sans modification. Le workflow doit produire explicitement une version choisie ; il ne remplace jamais un asset d'une release existante.

### 5.2 Matrice exacte des 15 cellules

Le v2 conserve cinq categories et trois lieux, soit 15 tuples exacts :

- le tuple `food_overall|ma` vient de `hcp-ipc-2017-official-g1-monthly` et porte la serie `hcp.ipc2017.01` ;
- les quatorze autres tuples viennent de `hcp-ipc-2017-monthly` : les quatre categories detaillees pour les trois lieux et `food_overall` pour Tetouan et Al Hoceima.

Le v2 ne duplique donc jamais la cellule nationale alimentaire. Il n'invente aucune cellule recente de ville et ne melange pas deux valeurs dans la meme cle.

Chaque observation ajoute :

```ts
context_role: "fresh_national_context" | "historical_detailed_context";
granularity: "division" | "group_of_products";
```

`food_overall` est une `division`; les quatre categories detaillees sont des `group_of_products`. Seule la cellule nationale officielle recente porte `fresh_national_context`. Toutes les autres portent `historical_detailed_context`.

Le payload reste `decision_scope = "observation_only"`, ne contient aucune correlation, causalite, recommandation ou prix fournisseur et limite chaque tuple aux 24 observations les plus recentes de sa propre source.

### 5.3 Activation ERP progressive

Le client ERP devra accepter les contrats v1 et v2 en schemas stricts et verifier leurs trois assets separement. Une balise epinglee peut etre v1 ou v2. La decouverte automatique reste sur le dernier v1 stable tant qu'aucun v2 stable n'a franchi les tests de compatibilite ; elle choisit ensuite le dernier v2 stable compatible sans accepter de prerelease.

Le modele de dashboard doit representer la fraicheur par cellule et par source. Une cellule nationale recente ne rend pas les cellules locales anciennes « fraiches ». L'interface conserve la mention observation uniquement et ne cree aucune decision automatique.

## 6. Fiabilite des donnees matiere ERP-Snack

### 6.1 Modele de domaine

ERP-Snack ajoute une fonction pure et un loader en lecture seule pour une fenetre glissante de 30 jours se terminant a la date Casablanca demandee :

```ts
type MaterialDataReadiness = {
  status: "ready" | "partial" | "blocked";
  period: { start: string; end: string };
  soldProductCount: number;
  recipeCoveredProductCount: number;
  requiredIngredientCount: number;
  purchaseFormatCoveredIngredientCount: number;
  verifiedYieldIngredientCount: number;
  valuation: {
    reliableQuantity: number;
    incompleteQuantity: number;
    coveragePct: number | null;
  };
  recentReceiptCount: number;
  reliableReceiptItemCount: number;
  actions: Array<{
    code:
      | "complete_recipes"
      | "create_purchase_formats"
      | "verify_yields"
      | "record_stock_receipts"
      | "resolve_fifo_shortages";
    count: number;
    href: string;
    label: string;
  }>;
};
```

Le loader commence par `requirePermission("dashboard", "read")`, borne toutes ses lectures a la fenetre et utilise des lectures paginees/batchees. Il reutilise `fetchPaidOrderLineCoverage`, `fetchRealizedMaterialCost`, les recettes et items existants, `purchase_formats`, `stock_receipts` et `stock_receipt_items`. Il ne modifie aucune table et ne cree aucun cas automatiquement.

### 6.2 Regles de statut

`blocked` s'applique si au moins une condition est vraie :

- une vente matiere eligible concerne un produit sans recette complete ;
- la quantite FIFO incomplete est strictement positive ;
- des ventes matiere eligibles existent mais la couverture de valorisation est nulle.

`partial` s'applique lorsque la valorisation ne contient aucune quantite `incomplet`, mais qu'une quantite reste `legacy_estime`, qu'au moins un ingredient requis n'a pas de format d'achat actif, qu'au moins un rendement operationnel n'est pas verifie, ou qu'aucune reception recente fiable n'existe malgre des ventes eligibles.

`ready` exige simultanement : recettes completes pour tous les produits vendus, couverture FIFO a 100 %, format d'achat actif pour chaque ingredient requis, rendement verifie pour chaque ingredient operationnel et au moins une reception recente fiable lorsqu'il y a eu des ventes eligibles.

L'absence de reception recente seule donne `partial`, pas `blocked`, si le stock existant est correctement valorise. En l'absence totale de ventes eligibles, `coveragePct` reste `null` et l'etat est `partial` avec une explication de manque d'activite, jamais une fausse fiabilite.

### 6.3 Cout theorique incomplet

`buildReplacementCostPerPortionMap` ne doit plus permettre a l'agregation du dashboard de convertir silencieusement un cout manquant en zero. Son API est etendue ou completee par un resultat de couverture indiquant les produits demandes, couverts et manquants. Les vues top/flop, cout theorique et ecart de food cost affichent `null`/non exploitable lorsque la couverture requise n'est pas complete.

Le cout FIFO realise conserve ses regles actuelles ; cette modification n'affaiblit aucun blocage de marge.

### 6.4 Presentation compacte

Le dashboard patron/admin affiche une bande compacte `Fiabilite des couts` a proximite de la tendance d'activite ou du food cost. Elle montre : statut, couverture recettes, couverture valorisation et au plus trois actions prioritaires. Elle ne cree pas une nouvelle grande carte et remplace l'avertissement generique « completez le CA hebdo et les fiches recettes » lorsqu'un diagnostic exact est disponible.

Les liens sont fixes :

- `complete_recipes` vers `/recipes` ;
- `create_purchase_formats`, `verify_yields` et `record_stock_receipts` vers `/expenses?tab=stock` ;
- `resolve_fifo_shortages` vers `/alerts?tab=review`.

Les autres roles conservent leur dashboard actuel. Le composant est purement informatif et ne contient ni formulaire ni action automatique.

## 7. Trajectoire, prevision et decisions futures

Le lot present fiabilise les entrees necessaires aux previsions ; il ne promet pas encore une trajectoire 2030 fiable. La phase suivante utilisera des scenarios P10/P50/P90 avec hypothese explicite, historique de ventes, couts matiere fiables, charges, paie, tresorerie, dettes, echeanciers et investissements.

Une mention « risque de faillite » ne sera permise que si la projection de tresorerie et les obligations financieres sont couvertes. Sinon l'ERP parlera de « trajectoire non soutenable selon les hypotheses disponibles » et indiquera les donnees manquantes. Les actions proposees — renegocier un achat, reduire une portion, augmenter un prix, promouvoir ou retirer un plat — seront classees par impact estime, expliquees et soumises a approbation humaine.

## 8. Deploiement par portes de controle

### Porte A — implementation locale Data Hub

Tests de contrats, connecteur, parseur, qualite, revisions, orchestration et workflows ; lint, typage, build et audit de secrets. Aucun appel reseau reel dans les tests ordinaires.

### Porte B — PR Data Hub

Branche poussee et PR brouillon seulement sur autorisation d'ecriture GitHub. CI verte et revue avant fusion.

### Porte C — ingestion publique candidate

Apres fusion autorisee, lancement manuel `verify`, inspection des cinq sources, des periodes et des quarantaines. Aucune publication automatique tant que les labels et valeurs ne sont pas controles.

### Porte D — release consommateur v2 candidate

Publication prerelease explicite, verification des 15 tuples et test ERP epingle. Le v1 stable reste le repli.

### Porte E — ERP local et preview

Implementation dans un worktree ERP-Snack propre, sans migration. Tests cibles, suite complete, lint, typage, build et verification visuelle minimale. Preview Vercel seulement sur autorisation.

### Porte F — production

Fusion ERP, activation v2 stable et promotion Vercel demandent chacune une autorisation explicite. Le rollback consiste a retirer l'activation v2 ou a redeployer le SHA ERP precedent ; aucune donnee transactionnelle n'est reecrite.

## 9. Hors perimetre de ces trois lots

- import automatique de tickets/factures historiques de juillet-aout ;
- migrations Supabase, RLS ou nouvelles tables ERP ;
- collecte ONP, meteo, carburant, change, metaux ou transport ;
- entrainement d'un modele ML et publication d'une trajectoire 2030 ;
- recommandation automatique executee sans validation humaine ;
- modification, suppression ou republication d'une release existante ;
- deploiement production ou activation d'un workflow distant.

## 10. Preuves d'acceptation

Le programme est considere pret a l'activation seulement si :

1. les cinq classeurs fixtures sont analyses avec les etiquettes et periodes attendues ;
2. un nouvel emballage XLSX semantiquement identique produit `no_change` sans nouveau dataset ;
3. un changement de valeur produit une revision et une nouvelle version ;
4. une etiquette inattendue ou une periode future met le run en quarantaine ;
5. le consommateur v1 est byte-compatible et ses tests ne changent pas ;
6. le v2 contient exactement 15 tuples, deux sources et une seule cellule nationale fraiche ;
7. l'ERP classe correctement `ready`, `partial` et `blocked`, sans cout manquant converti en zero ;
8. aucune migration, release, fusion ou production n'est declenchee implicitement ;
9. toutes les validations locales proportionnees au risque sont vertes avec Node 22.22.3.
