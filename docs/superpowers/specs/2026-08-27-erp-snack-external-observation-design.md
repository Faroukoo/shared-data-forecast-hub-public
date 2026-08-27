# Data Hub et ERP-Snack — observation externe juillet-août

Statut : design approuvé en conversation le 2026-08-27. Cette spécification écrite doit encore être relue par le propriétaire avant la rédaction du plan d'implémentation. Elle n'autorise ni publication de release, ni modification de production, ni activation de fonctionnalité.

## 1. Objectif

Connecter ERP-Snack au Data Hub dans un premier mode strictement informatif afin de comparer juillet 2026, mois complet, à août 2026, mois en cours, tout en affichant le contexte macroéconomique officiel disponible.

Ce lot doit prouver quatre points avant toute intégration aux prévisions ou aux alertes :

1. le Data Hub peut livrer un contrat consommateur léger, intègre et versionné sans exposer l'archive complète ;
2. une panne ou une donnée externe périmée ne change jamais le dashboard actuel ;
3. l'ERP peut produire une comparaison juillet-août honnête malgré des périodes de durées et de compositions calendaires différentes ;
4. le patron et l'administrateur peuvent distinguer les faits internes, le contexte externe et les limites de l'analyse.

Le résultat est une observation. Il ne modifie aucun prix, achat, recette, quantité, plat, alerte, scénario 2030 ou écriture comptable.

## 2. Références auditées

État observé le 2026-08-27 :

- Data Hub public : `Faroukoo/shared-data-forecast-hub-public`, branche `main`, SHA `cac3892d5f076daa579a75c1a2d7ab2f03453341` ;
- snapshot public courant : tag `data-20260827T095123Z-9d3b77bbfc0c`, trois assets obligatoires, snapshot `9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226` ;
- ERP-Snack : `qc93170-a11y/ERP-SNACK`, branche `main`, SHA `886799923148d534ee74c901252c86dbbaf12743` ;
- déploiement Vercel Production ERP-Snack observé sur ce même SHA ;
- moteur de trajectoire actuel : `internal-linear-v1`, signaux externes explicitement `not_connected` ;
- cockpit de décisions actuel : consultatif, limité aux rôles autorisés et sans mutation automatique.

Ces références servent de bases anti-régression. Leur évolution future devra être réauditée avant l'implémentation.

## 3. Périmètre

### 3.1 Inclus

- projection publique légère issue d'un snapshot Data Hub déjà validé ;
- nouvelle famille de releases immuables `consumer-v1-*`, séparée des releases `data-*` ;
- profil d'indicateurs macro pertinents pour ERP-Snack, exclusivement sélectionnés parmi les séries déjà qualifiées ;
- découverte, téléchargement, validation et cache du contrat côté serveur ERP ;
- observation de juillet 2026 complet et août 2026 arrêté à la date de Casablanca ;
- comparaison normalisée par jours d'ouverture et composition des jours de semaine ;
- affichage séparé pour `patron` et `admin` ;
- feature flag serveur désactivé par défaut ;
- tests hors ligne, preview et preuves de non-régression.

### 3.2 Exclus

- modification de `BusinessTrajectory`, de `internal-linear-v1` ou de ses scénarios 2030 ;
- changement de `buildDashboardDecisionActions` ou ajout de recommandations automatiques ;
- score de faillite, certitude de croissance ou probabilité non calibrée ;
- prévision du prix d'un ingrédient à partir d'un indice HCP macro ;
- écriture Supabase, migration, nouvelle table, Storage ou changement RLS ;
- stockage d'une donnée ERP dans le dépôt ou les releases publics ;
- nouvelle source ONP, ASAA, BAM, météo, carburant ou fournisseur privé ;
- refonte générale du dashboard ;
- nouveau service Vercel, serveur permanent, conteneur ou ressource facturable ;
- fusion, release stable, déploiement ou activation de production sans autorisation distincte.

## 4. Options et décision

### 4.1 Retenue : release consommateur dérivée et séparée

Une projection déterministe est construite depuis un snapshot Data Hub restauré et validé. Elle est publiée dans une release `consumer-v1-*` indépendante.

Cette séparation est obligatoire parce que le workflow de restauration courant exige exactement trois assets par release `data-*` et refuse une seconde publication du même `snapshot_id`. Ajouter un quatrième asset casserait ce contrat ou obligerait à réécrire une release immuable.

### 4.2 Écartée : télécharger l'archive complète dans l'ERP

L'archive courante dépasse 17 Mo. La télécharger et l'extraire dans une requête de dashboard gaspillerait bande passante et temps de démarrage, augmenterait les modes de panne et exposerait au consommateur des données qu'il n'utilise pas.

### 4.3 Écartée : fichier mutable ou API dédiée

Un fichier `latest.json` réécrit ou une nouvelle API simplifierait l'URL mais créerait une seconde vérité, une infrastructure supplémentaire ou une perte d'immuabilité. La découverte GitHub publique, mise en cache, suffit à ce lot.

## 5. Architecture

```text
Sources HCP qualifiées
        |
        v
Release data-* immuable, exactement trois assets
        |
 restauration et validation intégrales
        |
        v
Projection déterministe ERP-Snack
        |
        v
Release consumer-v1-* immuable, exactement trois assets
        |
 découverte et vérification côté serveur
        |
        v
Observation ERP privée juillet-août
        |
        v
Carte patron/admin sans effet sur les décisions
```

Le flux est à sens unique. Les données ERP ne quittent jamais ERP-Snack et ne sont jamais envoyées au Data Hub.

## 6. Famille de releases `consumer-v1-*`

### 6.1 Identité et nom

Le tag suit :

`consumer-v1-YYYYMMDDTHHMMSSZ-<12-premiers-caractères-du-payload-sha256>`

Une release consommateur référence un seul snapshot source. Son tag, ses notes, ses assets et son payload sont immuables après publication. Une pré-release vérifiée peut uniquement être promue en release stable en basculant son indicateur `prerelease` de `true` à `false` ; aucun autre champ ni fichier ne change. Deux payloads byte-identiques ne créent pas deux releases publiques.

### 6.2 Assets obligatoires

Chaque release contient exactement :

1. `consumer-index.json` ;
2. `consumer-v1.json` ;
3. `consumer-v1.json.sha256`.

`consumer-index.json` porte au minimum :

- `schema_version: "1.0.0"` ;
- `consumer_contract: "erp-snack-observation-v1"` ;
- `created_at` et `code_sha` ;
- `source_snapshot_tag` et `source_snapshot_id` ;
- nom, longueur et SHA-256 de `consumer-v1.json` ;
- nombre d'indicateurs, bornes de couverture et sources incluses ;
- `contains_confidential_data: false` ;
- `decision_scope: "observation_only"`.

Le sidecar contient le digest standard du payload. Le digest calculé doit correspondre simultanément au sidecar, à l'index et au digest de l'asset exposé par GitHub lorsqu'il est disponible.

### 6.3 Construction

Le constructeur :

1. sélectionne explicitement une release publique `data-*` ;
2. restaure ses trois assets dans un répertoire temporaire vide ;
3. vérifie l'archive, le manifeste, les datasets et `contains_confidential_data=false` ;
4. sélectionne uniquement les séries autorisées par le profil `erp-snack-observation-v1` ;
5. sérialise le payload de façon canonique et déterministe ;
6. vérifie les trois nouveaux assets avant toute publication ;
7. refuse de publier si la source, la licence, le schéma, l'intégrité ou la frontière publique échoue.

La première exécution est manuelle et produit une pré-release. L'automatisation ultérieure peut s'exécuter après un nouveau snapshot valide et retourne `no_change` si le payload est identique.

## 7. Contrat `consumer-v1.json`

Le payload est strict et rejette tout champ inconnu. Il contient :

- `schema_version` ;
- `consumer_contract` ;
- `source_snapshot_tag`, `source_snapshot_id` et `generated_at` ;
- `profile_id: "erp-snack-observation-v1"` ;
- `contains_confidential_data: false` ;
- une liste ordonnée et unique de sources ;
- une liste ordonnée d'indicateurs et de leurs observations mensuelles ;
- les avertissements de fraîcheur et de qualité ;
- les bornes de période réellement disponibles.

Chaque source expose :

- identifiant stable et éditeur officiel ;
- URL de provenance déjà qualifiée ;
- statut de santé ;
- date de récupération ;
- dernière période observée ;
- âge, seuil d'avertissement et seuil d'expiration ;
- licence et avertissements applicables.

Chaque observation expose :

- clé de série stable et libellé français ;
- usage `macro_context_only` ;
- catégorie économique ;
- géographie et unité exactes ;
- période de début et de fin ;
- valeur décimale sérialisée en chaîne ;
- base et facteur d'échelle lorsqu'ils existent ;
- identifiant de source, checksum brut et révision ;
- qualité et codes d'avertissement.

La projection conserve au plus les 24 dernières observations mensuelles par série. La sélection est une allowlist versionnée de clés canoniques existantes, jamais une recherche approximative par libellé. Une série HCP reste un contexte macro ; elle n'est jamais étiquetée comme prix fournisseur ou prix d'achat d'un ingrédient.

## 8. Découverte et validation côté ERP

Le client s'exécute uniquement côté serveur.

Le flag s'appelle `DATA_HUB_OBSERVATION_ENABLED`. Il vaut `false` en l'absence de valeur explicite `true`. En preview, `DATA_HUB_CONSUMER_RELEASE_TAG` épingle obligatoirement un tag `consumer-v1-*` précis. Une production ultérieure sans tag épinglé peut découvrir les 30 releases publiques GitHub les plus récentes, filtrer les releases non brouillon et non pré-release dont le tag commence par `consumer-v1-`, puis choisir la plus récente selon le `created_at` validé de son index.

Le client :

- utilise un budget maximal global de trois secondes pour la découverte et les téléchargements ; après la découverte, les trois petits assets sont récupérés en parallèle dans le temps restant ;
- limite le nombre de releases inspectées et la taille de chaque réponse ;
- accepte uniquement les hôtes GitHub allowlistés ;
- vérifie exactement trois assets et refuse les doublons ;
- valide index, sidecar, payload, digests et cohérence du snapshot ;
- rejette les versions majeures inconnues ;
- met le résultat valide en cache serveur pendant 24 heures ;
- ne journalise ni cookie, ni en-tête d'autorisation, ni contenu métier ERP.

Le feature flag serveur est désactivé par défaut. Lorsqu'il est désactivé, aucun appel réseau Data Hub n'est lancé et aucune variable de tag n'est requise.

## 9. Observation interne juillet-août

### 9.1 Fenêtres

- référence : du 2026-07-01 au 2026-07-31 ;
- observation : du 2026-08-01 à `as_of_date`, en fuseau `Africa/Casablanca` ;
- `as_of_date` ne dépasse ni la date courante de Casablanca, ni le 2026-08-31 ;
- la date d'arrêt est affichée dans l'interface et conservée dans le résultat d'analyse.

### 9.2 Données ERP réutilisées

Le lot étend les agrégats existants sans construire un deuxième P&L :

- chiffre d'affaires et nombre de commandes depuis les sources de revenus déjà utilisées par le dashboard ;
- panier moyen comptoir et Glovo selon les règles déjà en place ;
- coût matière réalisé et couverture de valorisation depuis le registre financier existant ;
- coût matière théorique depuis les recettes et coûts de remplacement existants ;
- charges, paie et résultat depuis `MonthlyPLRow`, seulement à leur granularité mensuelle ;
- jours de repos et fermetures depuis les réglages et actions existants.

Une extraction par intervalle réutilisable peut être ajoutée autour des fonctions actuelles. Elle ne change pas leurs résultats, contrats publics ou caches existants.

### 9.3 Comparaison calendaire

Les totaux bruts juillet contre août ne constituent pas la comparaison principale.

Pour chaque métrique quotidienne :

1. déterminer les jours d'ouverture attendus ;
2. exclure les jours sans donnée exploitable et les compter dans la couverture ; une valeur nulle explicite est une observation, mais l'absence de ligne un jour ouvert est une donnée manquante sauf si la source existante sait représenter explicitement zéro ;
3. calculer en juillet une moyenne par jour de semaine ;
4. pondérer ces moyennes par le nombre de lundis, mardis, etc. réellement observés en août ;
5. comparer août à cette référence juillet normalisée ;
6. afficher séparément les totaux bruts et la variation normalisée.

Les ratios de marge et de food cost sont recalculés depuis leurs numérateurs et dénominateurs agrégés. Ils ne sont jamais obtenus en faisant la moyenne de pourcentages journaliers.

### 9.4 Projection de fin août

La projection utilise les moyennes août par jour de semaine et le calendrier d'ouverture restant. Elle produit une estimation centrale et une fourchette descriptive issue de la variabilité journalière observée. Cette fourchette n'est pas nommée P10/P50/P90 et n'est pas présentée comme une probabilité calibrée.

Seuls le chiffre d'affaires, les commandes, le panier et les mesures de coût matière appuyées par des observations journalières peuvent être projetés. Les charges, la paie et le résultat mensuels sont affichés comme état de comptabilisation et ne sont ni proratisés ni projetés dans ce lot.

Une projection n'est pas produite si la couverture interne est `non_exploitable`.

### 9.5 Qualité interne

Pour les métriques nécessitant ventes et coût matière :

- `fiable` : au moins 14 jours ouverts exploitables et au moins 90 % des jours attendus couverts, avec valorisation matière complète ;
- `a_surveiller` : au moins 7 jours ouverts exploitables et au moins 70 % de couverture, ou valorisation partielle explicitement signalée ;
- `non_exploitable` : moins de 7 jours, moins de 70 % de couverture, incohérence de dates ou dénominateur requis nul.

Chaque métrique conserve son propre statut. Le statut global est :

- `Fiable` seulement si les métriques internes affichées sont fiables, le contrat externe est intègre et au moins une observation externe non expirée couvre une période alignée ;
- `À surveiller` si les métriques internes restent exploitables mais sont partielles, ou si le contexte externe est ancien, expiré ou non aligné ;
- `Non exploitable` si les métriques internes principales sont non exploitables ou si le contrat externe échoue à l'intégrité.

Un statut global dégradé ne masque jamais un résultat interne valide ; les statuts interne et externe restent affichés séparément.

## 10. Rapprochement avec le contexte externe

Le rapprochement respecte les périodes réelles :

- une observation externe couvrant juillet ou août peut être affichée à côté de la période correspondante ;
- une série plus ancienne est affichée comme dernier contexte connu avec son âge ;
- l'absence de période externe alignée interdit tout calcul de corrélation juillet-août ;
- aucune causalité n'est déduite d'une coïncidence ;
- aucune série IPP ou IPC n'est convertie en MAD/kg ou en prix fournisseur ;
- aucun coefficient externe n'entre dans `BusinessTrajectory` pendant ce lot.

La restitution sépare toujours : fait ERP, contexte externe, qualité et interprétation prudente.

Au moment de l'audit, les deux sources HCP du snapshot courant sont intègres mais `stale`. Le premier résultat attendu peut donc être un contexte externe `À surveiller`, sans période alignée sur juillet-août 2026. Ce résultat valide le chemin technique et la transparence de qualité ; il ne valide pas encore l'usage prédictif de ces séries.

## 11. Interface et autorisations

Une carte additive intitulée `Contexte externe — phase d'observation` est placée à proximité de la trajectoire existante. Elle ne remplace aucun composant du dashboard.

Elle est visible uniquement lorsque :

- le rôle est `patron` ou `admin` selon les capacités existantes ;
- le feature flag serveur est actif ;
- le dashboard est dans un mode compatible.

Elle affiche :

- période d'arrêt et fenêtres comparées ;
- variation interne brute et normalisée ;
- couverture et état de valorisation ;
- dernière période externe réellement disponible ;
- statut `Fiable`, `À surveiller` ou `Non exploitable` ;
- texte fixe indiquant qu'aucune décision automatique n'est prise.

Lorsque le flag est actif et le rôle autorisé, la carte est toujours rendue. Si le contrat externe est indisponible, elle affiche l'état discret `Contexte externe indisponible` et les résultats internes encore valides. Le reste de la page reste identique.

## 12. Isolation et gestion des erreurs

Le client Data Hub et l'analyseur sont séparés :

- le client ne connaît aucune donnée ERP ;
- l'analyseur reçoit des structures validées et ne fait aucun réseau ;
- le composant reçoit un view-model sans identifiant ou détail sensible ;
- `BusinessTrajectory` et `buildDashboardDecisionActions` ne dépendent d'aucun de ces modules.

Les erreurs suivantes sont non bloquantes pour le dashboard : délai dépassé, GitHub indisponible, release absente, asset dupliqué, taille excessive, checksum divergent, schéma inconnu, snapshot incohérent, source périmée ou données internes insuffisantes.

Elles produisent un code sûr et un état d'observation, jamais une exception remontée à l'utilisateur. Une entrée déjà présente dans le cache de 24 heures reste utilisable avec son âge réel. Après expiration, un échec de rafraîchissement rend le contexte externe indisponible ; aucun stockage persistant de secours n'est ajouté et aucune donnée périmée n'est présentée comme fraîche.

## 13. Sécurité, confidentialité et coût

- aucune credential GitHub n'est requise pour lire les releases publiques ;
- aucune donnée ERP n'est transmise, persistée ou journalisée par le Data Hub ;
- aucun identifiant client, fournisseur, recette, marge privée ou détail de commande n'apparaît dans une release ;
- les réponses distantes sont bornées avant parsing ;
- les champs inconnus échouent fermé ;
- aucune URL arbitraire fournie par l'utilisateur n'est suivie ;
- l'observation couvre au maximum 62 jours et les données financières sont chargées par requêtes bornées et paginées, sans boucle distante par jour ;
- aucun nouveau Supabase, Vercel, serveur, conteneur, cache facturable ou dépendance globale n'est ajouté ;
- la cadence de génération reste liée aux snapshots et le cache ERP est de 24 heures.

## 14. Tests

### 14.1 Data Hub

- génération déterministe du même payload depuis le même snapshot et le même profil ;
- tri stable, valeurs décimales sans dérive et limite de 24 observations ;
- refus d'une série hors allowlist, d'une source non qualifiée ou d'une licence incompatible ;
- refus de toute marque de confidentialité ;
- validation exacte des trois assets `consumer-v1-*` ;
- corruption d'un octet détectée par les trois preuves de digest ;
- `no_change` pour un payload déjà publié ;
- pré-release non sélectionnée comme contrat stable ;
- workflows `data-*` historiques toujours testés avec exactement trois assets ;
- suite complète, lint, typage et build inchangés.

### 14.2 ERP-Snack

- client : release valide, absence, doublon, taille, timeout, digest, schéma, snapshot et cache ;
- feature flag désactivé : zéro requête externe et rendu fonctionnel existant inchangé ;
- analyse : juillet complet, août partiel, jours fermés, composition des jours de semaine, couverture et date de Casablanca ;
- ratios : agrégation correcte des numérateurs/dénominateurs et division par zéro ;
- projection : absence lorsque la couverture est insuffisante et libellé non probabiliste ;
- contexte : période alignée, série ancienne, série expirée et absence de causalité ;
- rôles : visible seulement pour patron/admin autorisés ;
- panne Data Hub : trajectoire, décisions et dashboard toujours rendus ;
- tests existants de trajectoire, cockpit, P&L, permissions et dashboard ;
- lint, typage, suite complète et build.

## 15. Séquence de livraison

1. Réauditer les SHA, worktrees et tâches actives.
2. Implémenter et tester le contrat consommateur dans une branche Data Hub isolée.
3. Créer une PR Data Hub et obtenir une CI verte.
4. Construire une pré-release `consumer-v1-*` depuis le snapshot courant, sans modifier `data-*`.
5. Implémenter l'adaptateur ERP depuis le SHA de production réaudité, dans un autre worktree isolé.
6. Pointer uniquement la preview ERP vers le tag précis de la pré-release.
7. Observer juillet et août en lecture seule et documenter couverture, fraîcheur et écarts.
8. Vérifier que le flag désactivé conserve la production actuelle.
9. Demander une autorisation distincte avant la release consommateur stable.
10. Demander une autorisation distincte avant toute fusion ou mise en production ERP.
11. Même après déploiement, garder le flag désactivé jusqu'à validation explicite de l'affichage et des résultats.

La publication stable du Data Hub et le déploiement ERP sont deux opérations différentes. L'une n'autorise pas l'autre.

## 16. Critères d'acceptation

Le lot d'observation est acceptable seulement si :

1. aucune release `data-*` existante n'est modifiée ;
2. la restauration Lot 1 continue d'exiger et valider exactement trois assets ;
3. la release consommateur est reproductible, vérifiable et sans donnée confidentielle ;
4. l'ERP ne télécharge jamais l'archive complète ;
5. le flag désactivé produit zéro appel Data Hub ;
6. une panne Data Hub n'empêche jamais le dashboard de fonctionner ;
7. juillet et août sont comparés avec une date d'arrêt et une normalisation calendaire visibles ;
8. toute insuffisance de couverture ou de valorisation est affichée ;
9. les périodes externes anciennes ne sont pas rapprochées artificiellement de juillet-août ;
10. les moteurs de trajectoire et de décisions existants sont byte-for-byte inchangés ou leurs sorties sont prouvées identiques ;
11. aucune migration, écriture distante, ressource payante ou action automatique métier n'est introduite ;
12. les validations locales, CI et preview sont réussies avant toute nouvelle demande de production.

## 17. Décisions fixes

- le mode initial est observation seulement ;
- juillet 2026 est le mois de référence et août 2026 est arrêté à une date explicite ;
- les données publiques circulent vers l'ERP, jamais l'inverse ;
- les releases `data-*` et `consumer-v1-*` restent séparées et immuables ;
- la série macro explique un contexte, pas un prix d'achat ;
- la qualité précède toute prévision ;
- la corrélation ne vaut pas causalité ;
- les recommandations restent humaines et le scénario 2030 reste inchangé ;
- aucune production n'est corrigée ou déployée implicitement.
