# Data Hub — production gratuite par snapshots GitHub

Statut : implémentation prête pour vérification lorsque toutes les validations locales sont réussies ; l’audit public et les activations distantes restent soumis aux barrières décrites ci-dessous, et la production n’est pas encore active.

## 1. Décision et résultat attendu

Le lot décrit ici met le Data Hub en exploitation continue pour ses deux sources HCP déjà qualifiées, sans service résident et sans ressource facturable :

- un workflow GitHub Actions public interroge les sources une fois par semaine ;
- l’état de données valide est restauré depuis le dernier snapshot distant avant chaque exécution ;
- une nouvelle version immuable est publiée uniquement lorsque les octets officiels ont changé et que tous les contrôles obligatoires passent ;
- un incident conserve le dernier snapshot valide, produit une preuve exploitable et n’écrase aucune donnée ;
- le snapshot initial reprend les données locales déjà validées, puis fait l’objet d’un exercice réel de restauration.

Le résultat n’est pas encore un service de prévision ni un dashboard ERP. Il constitue le stockage durable, la planification, la reprise et la surveillance qui manquaient au lot 1 avant de connecter ERP-Snack, CasaNext, TournAxis ou NSOGO.

## 2. Contraintes non négociables

1. Aucun nouveau projet Supabase, déploiement Vercel, serveur permanent, runner auto-hébergé ou fournisseur payant.
2. Le dépôt peut devenir public seulement après un audit de tout son historique Git pour les secrets et les données privées.
3. Les snapshots publics ne contiennent que les séries macroéconomiques publiques qualifiées et leurs preuves de provenance.
4. Les achats, ventes, recettes, marges, fournisseurs et prévisions propres aux sociétés restent hors de ce dépôt et hors de ses releases publiques.
5. Un artefact, un dataset ou un snapshot validé n’est jamais réécrit ni supprimé par l’automatisation.
6. Une erreur réseau, un changement de schéma, une quarantaine ou une licence bloquée ne peut pas publier un nouvel état.
7. La restauration est prouvée, pas seulement documentée, avant de considérer le lot comme exploitable.

## 3. Options évaluées

### 3.1 Retenue : dépôt GitHub public, Actions standard et Releases

Le code est rendu public sans publication npm. Les runners GitHub standard sont gratuits pour un dépôt public. Les snapshots sont stockés comme assets de releases GitHub et non comme artifacts Actions temporaires.

L'audit du 2026-08-27 a détecté une adresse d'auteur personnelle dans l'historique du dépôt privé source. La cible de production est donc le nouveau dépôt `Faroukoo/shared-data-forecast-hub-public`, initialisé depuis deux arbres audités avec un historique propre et une attribution GitHub `noreply`. Le dépôt `Faroukoo/shared-data-forecast-hub` reste une archive privée ; aucun de ses commits historiques n'est publié ni réécrit.

Avantages : aucune machine à maintenir, historique distant, exécution planifiée, journal d’audit, téléchargement public sans distribuer de secret et coût direct nul avec les conditions GitHub actuelles.

Limites : GitHub reste un fournisseur unique ; la visibilité du code et des incidents est publique ; une future modification des tarifs ou de la visibilité impose une nouvelle revue d’exploitation.

### 3.2 Écartée : conserver le dépôt privé avec GitHub Actions

Un dépôt privé bénéficie d’un quota inclus, mais l’exécution dépend d’un compteur mensuel et peut devenir facturable selon le compte et les budgets configurés. Cette option ne satisfait pas l’objectif de fonctionnement sans risque de consommation payante.

### 3.3 Écartée : scheduler local ou runner auto-hébergé

Cette option économise les minutes cloud mais dépend d’un Mac allumé, de sa connexion, de son stockage et de sa maintenance. Elle dégrade la continuité et ferait partager une ressource déjà utilisée par d’autres projets.

### 3.4 Écartée : nouveau Supabase ou Vercel

Les projets Supabase gratuits accessibles sont déjà occupés par des applications métier. Vercel Hobby ne fournit pas ici le stockage historique durable requis. Réutiliser une base métier mélangerait les responsabilités, les quotas et les risques de sécurité.

## 4. Périmètre

### 4.1 Inclus

- publication publique contrôlée du dépôt après audit ;
- workflow manuel et hebdomadaire pour `hcp-ipc-2017-monthly` et `hcp-ipp-2018-monthly` ;
- orchestration des deux ingestions dans une exécution complète ;
- construction, vérification, publication et restauration des snapshots ;
- bootstrap distant à partir de `.data-hub` local déjà validé ;
- état de santé visible dans le résumé du workflow et dans des issues GitHub anti-doublon ;
- documentation opérateur, reprise après incident et preuve de coût nul ;
- tests ciblés, tests complets, lint, typage et build.

### 4.2 Hors périmètre

- prévisions, apprentissage automatique et scénarios jusqu’en 2030 ;
- données confidentielles ou transactionnelles des sociétés ;
- API publique, authentification consommateur ou modification d’un ERP ;
- nouvelles sources ONP, BAM, Office des Changes, métaux, énergie ou météo ;
- imports manuels non déjà qualifiés ;
- licence open source du code ; rendre le dépôt public n’accorde pas automatiquement un droit de réutilisation.

Ces travaux feront l’objet de lots séparés. En particulier, le moteur de décision ERP-Snack devra consommer les séries publiques depuis ce hub tout en gardant ventes, stocks, recettes et marges dans son environnement privé.

## 5. Architecture cible

```text
Planification hebdomadaire ou lancement manuel
                       |
                       v
      Vérification visibilité + environnement
                       |
                       v
       Dernière release de données valide
                       |
               téléchargement + SHA-256
                       |
                       v
        restauration dans un répertoire vide
                       |
              validation intégrale locale
                       |
                       v
       ingestion IPC puis IPP, sans arrêt court
                       |
              rapport terminal combiné
                       |
          +------------+-------------+
          |                          |
     tout est valide           incident/quarantaine
          |                          |
   changement réel ?          aucune publication
      |          |             issue de santé
     non        oui            dernier état conservé
      |          |
    journal   snapshot déterministe
               |
        release brouillon
               |
     relecture des assets
               |
      publication atomique
```

Le workflow ne transporte pas l’état entre deux runs par cache ou artifact Actions. Chaque run repart d’un répertoire neuf et restaure explicitement le dernier snapshot publié.

## 6. Composants et interfaces

### 6.1 Orchestrateur de production

Une commande applicative unique exécute toutes les sources activées dans l’ordre du registre. Elle poursuit l’examen des autres sources après un incident pour produire un diagnostic complet, puis renvoie un code non nul si au moins une source termine en `quarantined`, `failed_retryable` ou `failed_terminal`.

Elle écrit un rapport JSON versionné et validé sous le répertoire de travail. Le rapport contient au minimum :

- version du schéma ;
- horodatage de début et de fin ;
- SHA Git du code ;
- source, run ID, état terminal, artefact SHA-256, dataset ID et codes d’avertissement ;
- décision globale `no_change`, `publishable` ou `blocked` ;
- motifs structurés de blocage, sans URL signée, jeton ou donnée sensible.

La sortie console reste sûre et lisible, mais le workflow prend ses décisions depuis le fichier JSON validé, jamais depuis une expression régulière sur les logs.

### 6.2 Constructeur de snapshot

Le constructeur accepte uniquement un `.data-hub` déjà validé et une liste fixe de racines :

- `raw/` ;
- `manifests/` ;
- `published/` ;
- `runs/` ;
- `quality/`.

Il refuse les liens symboliques, liens physiques, fichiers spéciaux, chemins absolus et segments `..`. Les fichiers sont triés par chemin avant archivage. Les métadonnées volatiles de l’archive sont normalisées pour que les mêmes fichiers produisent les mêmes octets.

Le constructeur génère :

1. une archive `data-hub-<archive-sha256>.tar.gz` ;
2. un fichier standard `data-hub-<archive-sha256>.tar.gz.sha256` ;
3. un `snapshot-index.json`, dont le digest SHA-256 exposé par GitHub est contrôlé après envoi.

### 6.3 Vérificateur et restaurateur

Le restaurateur :

1. télécharge l’index, le sidecar et l’archive de la même release ;
2. compare le SHA-256 local au sidecar et au digest exposé par GitHub ;
3. inspecte toutes les entrées avant extraction ;
4. extrait uniquement dans un répertoire neuf et vide ;
5. valide les schémas JSON, les checksums d’artefacts, les checksums canoniques et la cohérence des manifests ;
6. refuse tout snapshot partiel, inconnu ou plus récent que les contrats pris en charge.

Le workflow ne lance aucune requête distante tant que cette restauration n’est pas entièrement valide.

### 6.4 Publication GitHub

Le job de publication utilise le `GITHUB_TOKEN` éphémère du workflow. Aucun token personnel durable n’est ajouté aux secrets.

Une release est d’abord créée en brouillon avec ses trois assets. Le job retélécharge ou relit la liste distante, contrôle les noms, tailles et digests, puis rend la release publique. Une release déjà publique n’est jamais modifiée. Un brouillon incomplet reste identifiable comme incident et n’est jamais utilisé par la restauration.

### 6.5 Surveillance de santé

Le résumé GitHub Actions expose pour chaque source : fraîcheur, état terminal, dernier artefact, dataset courant, avertissements et décision de publication.

Un job séparé, avec seulement `contents: read` et `issues: write`, maintient au plus une issue ouverte par source sous le titre stable `[data-health] <source-id>`. Il ajoute une occurrence à l’incident existant au lieu de créer du bruit, puis ferme l’issue lors d’un run sain. Les messages contiennent des codes structurés et des liens vers les runs, jamais le contenu brut téléchargé.

## 7. Contrat du snapshot

### 7.1 Identité

Le `snapshot_id` est le SHA-256 d’un état logique canonique contenant :

- version de schéma ;
- liste ordonnée des sources ;
- pour chaque source, dernier artefact valide, dataset publié et run terminal valide ;
- checksums des manifests de datasets ;
- checksum de l’inventaire ordonné des fichiers.

L’horodatage de création et le SHA Git sont des métadonnées auditables mais ne changent pas l’identité logique. Un même état de données ne produit pas deux snapshots. Avant toute publication, le workflow refuse aussi de créer une seconde release publique portant un `snapshot_id` déjà publié.

### 7.2 Nom de release

Le tag suit :

`data-YYYYMMDDTHHMMSSZ-<12-premiers-caractères-du-snapshot-id>`

Le titre suit :

`Data snapshot <snapshot_id court> — <date UTC>`

Le tag de code `v0.1.0` et les futures releases logicielles restent séparés des tags `data-*`.

### 7.3 Index externe

`snapshot-index.json` contient :

- `schema_version` ;
- `snapshot_id` et `created_at` ;
- `code_sha` ;
- `previous_snapshot_tag` ou `null` pour le bootstrap ;
- nom, taille et SHA-256 de l’archive ;
- checksum du manifeste interne ;
- résultats résumés par source ;
- identifiants de datasets publiés ;
- preuves de licence et URLs officielles déjà présentes dans les manifests ;
- indicateur `contains_confidential_data: false`.

Les consommateurs futurs sélectionnent uniquement la plus récente release publique dont le tag commence par `data-`, puis valident l’index et l’archive avant lecture.

## 8. Politique de publication

| Résultat IPC | Résultat IPP | Action |
|---|---|---|
| `no_change` | `no_change` | aucune release ; run réussi et résumé conservé |
| `published` | `no_change` | nouveau snapshot complet |
| `no_change` | `published` | nouveau snapshot complet |
| `published` | `published` | nouveau snapshot complet |
| incident ou quarantaine | tout état | aucune release ; état précédent conservé ; issue santé |
| tout état | incident ou quarantaine | aucune release ; état précédent conservé ; issue santé |

La publication est atomique au niveau métier : tous les datasets du snapshot restent cohérents avec un run global valide. L’état local restauré peut contenir les preuves d’un run échoué pendant le job, mais elles ne sont pas promues dans une release de données.

## 9. Planification et permissions

- cadence : chaque lundi à `05:17` dans le fuseau `Europe/Paris` ;
- déclencheurs : `schedule` et `workflow_dispatch` seulement ;
- concurrence : un seul run, sans annulation d’une publication en cours ;
- délai maximum borné pour chaque téléchargement et pour le job complet ;
- ingestion séquentielle pour ménager la source HCP et les ressources ;
- réseau interdit par défaut, activé explicitement seulement autour des commandes d’ingestion ;
- permissions globales `contents: read` ;
- `contents: write` uniquement dans le job de publication ;
- `issues: write` uniquement dans le job de santé ;
- aucune permission d’écriture pour un événement de pull request ou de fork ;
- actions tierces, y compris officielles, épinglées par SHA complet ;
- aucun cache ni artifact Actions uploadé.

Le workflow échoue immédiatement si le dépôt est privé. Si la visibilité doit redevenir privée, le scheduler doit être désactivé avant le changement afin de ne pas consommer un quota privé.

## 10. Frontière publique et sécurité

Avant la bascule publique, l’audit examine chaque commit et chaque blob joignable, pas seulement le checkout courant : noms de fichiers, secrets connus, clés privées, tokens, chaînes de connexion, exports, coordonnées personnelles et données société. Un résultat ambigu bloque la publication jusqu’à revue humaine.

La publication autorise uniquement :

- code source et tests du hub ;
- petits fixtures déjà contrôlés ;
- données HCP publiques qualifiées ;
- manifests de provenance, qualité et licence ;
- incidents techniques dépourvus de secrets.

Elle interdit notamment :

- `.env`, credentials, journaux bruts contenant des en-têtes ;
- données ERP, factures, prix négociés, fournisseurs, recettes ou identifiants clients ;
- fichiers manuels dont le droit de redistribution n’est pas explicite ;
- données d’une source `candidate`, `disabled` ou `licence_blocked`.

Le dépôt reste `private: true` dans `package.json` pour empêcher une publication npm accidentelle. Aucun fichier `LICENSE` n’est ajouté sans décision distincte du propriétaire. Les obligations ODbL et l’attribution HCP restent portées par les manifests et une notice publique dédiée.

## 11. Bootstrap et reprise

### 11.1 Snapshot initial

Le bootstrap utilise une copie en lecture seule de `.data-hub` local, qui contient les deux ingestions réelles déjà validées. Avant publication :

1. recalculer tous les checksums ;
2. valider les manifests et datasets ;
3. relancer les deux sources sur une copie pour prouver `no_change` ;
4. construire le snapshot ;
5. restaurer l’archive dans un répertoire temporaire vide ;
6. refaire toutes les validations ;
7. publier la première release `data-*` seulement si les preuves concordent.

La copie locale d’origine n’est ni déplacée ni supprimée.

### 11.2 Reprise d’un run normal

Chaque run sélectionne la dernière release `data-*` publique et validée, jamais une release logicielle ni un brouillon. Si aucun snapshot valide n’existe après le bootstrap, le run échoue sans ingestion.

### 11.3 Exercice de restauration

Le test de reprise final télécharge la release depuis GitHub, restaure dans un répertoire sans état préalable et exécute une ingestion distante. Les deux sources doivent retourner `no_change` si HCP n’a pas publié de nouveaux octets entre-temps ; si une source a réellement changé, son nouveau dataset doit passer les contrôles et créer le snapshot suivant.

## 12. Gestion des erreurs

- **GitHub indisponible ou release absente** : arrêt avant ingestion ; aucune reconstruction implicite depuis zéro.
- **Checksum distant divergent** : incident terminal de restauration ; aucune extraction.
- **Archive dangereuse ou partielle** : incident terminal ; aucune extraction.
- **HCP indisponible** : `failed_retryable`, issue santé, aucune release ; prochaine tentative à la cadence normale ou manuelle.
- **Structure XLSX modifiée** : quarantaine, preuve conservée seulement dans le run Actions, aucune release de données.
- **Source en retard** : warning visible ; `source_stale` ouvre ou maintient l’issue santé selon la politique déjà définie.
- **Échec pendant le brouillon** : le brouillon n’est pas un candidat de restauration ; aucun asset antérieur n’est touché.
- **Échec de publication après validation** : run en échec, ancien snapshot conservé ; relance manuelle idempotente.

Aucune tentative automatique n’utilise un miroir non officiel ou ne réduit les barrières de qualité.

## 13. Coût et sobriété

La conception évite les postes qui peuvent consommer un quota facturable :

- runner standard d’un dépôt public ;
- aucune base, fonction serverless, machine persistante ou runner auto-hébergé ;
- aucune archive Actions ni cache distant ;
- un seul run hebdomadaire, sources séquentielles et publication uniquement sur changement ;
- compression rapide plutôt que compression maximale, car l’archive observée est déjà de l’ordre de 20 Mo ;
- assets de release plutôt qu’un historique de datasets dans Git ;
- aucune dépendance globale ou conteneur supplémentaire.

Le caractère gratuit dépend des conditions GitHub en vigueur. Toute modification de visibilité, de runner, de stockage ou de fréquence est une modification d’architecture et doit repasser par une vérification de coût avant activation.

## 14. Tests et preuves d’acceptation

### 14.1 Tests automatisés

- rapport d’orchestration valide pour toutes les combinaisons d’états ;
- le second connecteur est diagnostiqué même si le premier échoue ;
- décision bloquée dès qu’une source est invalide ;
- archive déterministe pour des entrées identiques ;
- refus des chemins absolus, traversées, liens et fichiers spéciaux ;
- corruption d’un octet détectée avant extraction ;
- validation des manifests, fichiers bruts et JSONL restaurés ;
- sélection exclusive des releases publiques `data-*` ;
- absence de nouvelle release lorsque toutes les sources sont `no_change` ;
- rendu des issues anti-doublon et fermeture après récupération ;
- logs exempts de secrets connus et de contenu binaire.

### 14.2 Validation locale

- suite complète existante et nouveaux tests ;
- lint sans avertissement ;
- TypeScript strict ;
- build reproductible ;
- audit du diff et recherche de secrets ;
- empaquetage et restauration depuis un répertoire temporaire ;
- preuve que le checkout et le worktree d’origine restent intacts.

### 14.3 Validation distante

- dépôt public confirmé après l’audit ;
- workflow manuel réussi sur le SHA exact fusionné ;
- première release `data-*` avec trois assets et digests concordants ;
- téléchargement anonyme et restauration dans un répertoire vide ;
- second run produisant `no_change` sans nouvelle release, sauf changement source réel ;
- scheduler actif et prochaine cadence visible ;
- permissions du workflow relues ;
- aucune ressource Supabase, Vercel ou facturable créée.

## 15. Séquence de livraison et rollback

1. implémenter et tester sur la branche isolée ;
2. auditer le diff, les dépendances et tout l’historique Git ;
3. rendre le dépôt public après réussite de l’audit, afin que la CI de PR utilise les runners publics gratuits ;
4. pousser la branche et ouvrir une PR, avec le scheduler gardé inactif par une variable de production ;
5. fusionner uniquement après CI verte et revue ;
6. préparer localement un bootstrap vérifié et l’envoyer comme release brouillon ;
7. faire contrôler et publier ce brouillon par le workflow manuel du SHA fusionné ;
8. exécuter le test de restauration et le run d’idempotence ;
9. activer la variable du scheduler hebdomadaire.

Le rollback opérationnel consiste à désactiver le workflow planifié. Les releases valides restent disponibles et le dernier snapshot valide reste la référence. Revenir à une version logicielle antérieure se fait par un commit de correction ou de revert, sans réécrire les tags ni supprimer les preuves de données.

## 16. Critère de fin du lot

Le lot est terminé uniquement quand un poste vierge peut récupérer anonymement la dernière release, en vérifier toutes les preuves, restaurer les deux datasets HCP et obtenir une exécution hebdomadaire sûre sans utiliser une ressource payante. Cette réussite ne vaut pas encore connexion d’un ERP ni mise en production de prévisions métier.

## 17. Références d’exploitation

- [Facturation GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Ressources GitHub incluses](https://docs.github.com/en/billing/reference/product-usage-included)
- [Syntaxe des workflows et planification](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Limites des releases GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [Facturation Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Tarifs Supabase](https://supabase.com/pricing)
- [Usage et tarification des cron jobs Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)
