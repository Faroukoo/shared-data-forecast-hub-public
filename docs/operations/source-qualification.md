# Qualification des sources — HCP historique et indicateurs officiels

## Périmètre et décision

Le registre actif contient sept séries mensuelles qualifiées du Haut-Commissariat au Plan (HCP) : deux sources CKAN historiques sur `data.gov.ma` et cinq feuilles officielles HCP récentes. Elles peuvent alimenter les indicateurs macro des projets consommateurs, mais elles ne remplacent pas les prix d'achat réels, les factures fournisseurs ou les stocks de l'ERP Snack.

| Source | Référence qualifiée | Usage | Licence |
| --- | --- | --- | --- |
| `hcp-ipc-2017-monthly` | CKAN `0ebb73ec-1f04-4854-b73e-a7868b0b18b0`, ressource `6b44bd34-87ca-479b-b8e6-460f184269fb` | IPC base 100 en 2017, national et 18 villes | ODbL-1.0 |
| `hcp-ipp-2018-monthly` | CKAN `59a68619-4bd8-4086-8bea-5a0e4757b4d8`, ressource `1af2d785-b1c4-45c8-9194-b3e745a2deca` | Indices des prix à la production base 100 en 2018, national | ODbL-1.0 |
| `hcp-ipc-2017-official-g1-monthly` | IPC : classeur `1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8`, GID `0` | IPC officiel, groupe 1, national | CC BY 4.0 |
| `hcp-ipc-2017-official-g2-monthly` | IPC : classeur `1mwwtnpnnWH6rxnnLuz3j07QYsvxFVci6EKTCZea0t-8`, GID `1240277578` | IPC officiel, groupe 2, national | CC BY 4.0 |
| `hcp-ippi-2018-official-g1-monthly` | IPPI : classeur `1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro`, GID `1228710067` | IPPI officiel, groupe 1, national | CC BY 4.0 |
| `hcp-ippi-2018-official-g2-monthly` | IPPI : classeur `1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro`, GID `53126080` | IPPI officiel, groupe 2, national | CC BY 4.0 |
| `hcp-ippi-2018-official-g3-monthly` | IPPI : classeur `1dkerRpPLruxJqxQS7yvQSRwuKbk2tyW5D7DVG0U2Hro`, GID `872756965` | IPPI officiel, groupe 3, national | CC BY 4.0 |

API commune : `https://data.gov.ma/data/api/3/action/`.

Fichiers qualifiés :

- IPC : `https://data.gov.ma/data/dataset/0ebb73ec-1f04-4854-b73e-a7868b0b18b0/resource/6b44bd34-87ca-479b-b8e6-460f184269fb/download/i_7.5.xlsx` ;
- IPP : `https://data.gov.ma/data/fr/dataset/59a68619-4bd8-4086-8bea-5a0e4757b4d8/resource/1af2d785-b1c4-45c8-9194-b3e745a2deca/download/i_7.7.xlsx`.

Les pages dataset servent de preuve de licence ODbL 1.0 pour les deux sources CKAN. Ce régime reste distinct de celui des cinq feuilles officielles : leur page d'autorité est [IPC](https://www.hcp.ma/Indices-des-prix-a-la-consommation-IPC_r348.html) ou [IPPI](https://www.hcp.ma/Indices-des-prix-a-la-production-industrielle-IPPI_r624.html), et les [conditions générales HCP](https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html) prouvent la réutilisation sous CC BY 4.0, y compris commerciale avec attribution et intégrité. L'usage interne dérivé et la redistribution sont autorisés seulement selon la licence déclarée par chaque entrée du registre. Toute modification de licence bloque la publication jusqu'à une nouvelle qualification humaine ; les régimes ODbL et CC BY 4.0 ne sont jamais fusionnés.

Dernière période vérifiée le 2026-09-01 : juillet 2026 dans les cinq feuilles officielles. Les ressources CKAN ont une dernière modification fournisseur observée le 2025-02-06 : elles restent des séries historiques détaillées, sans être présentées comme une observation fraîche de 2026.

## Contrat fournisseur observé

Le classeur IPC contient les feuilles `Data` et `Metadata`. L'en-tête métier est à la ligne 4 : `Villes`, `Divisions et groupes de produits`, une colonne annuelle ignorée, puis les mois à partir de la colonne 4. La feuille de métadonnées doit déclarer une périodicité mensuelle, l'unité `Indice` et le HCP comme source. Les lieux sont limités au national et aux 18 villes explicitement enregistrées ; aucun rapprochement approximatif n'est permis.

Le classeur IPP utilise le même contrat de feuilles et de métadonnées. La première colonne est `Secteurs`, les autres colonnes utiles sont mensuelles et la géographie est nationale. Les secteurs sont normalisés en clés stables, tandis que le libellé source original reste conservé.

Les cinq exports officiels sont construits uniquement depuis les IDs et GIDs ci-dessus, sur `docs.google.com`, puis acceptent au plus trois redirections HTTPS vers un sous-domaine `*.sheets.googleusercontent.com`. Chaque profil est fermé : en-tête, colonnes, périodes et libellés source doivent correspondre exactement à la table revue du parseur. Une étiquette amont inconnue, accentuée différemment, déplacée ou renommée est une erreur de parseur et place le run en quarantaine. L'opérateur ne normalise jamais un libellé ; un changement réel exige une modification revue du registre et/ou du parseur avec ses tests.

Les mois admis sont exactement `Janv`, `Févr`, `Mars`, `Avr`, `Mai`, `Juin`, `Juill`, `Août`, `Sept`, `Oct`, `Nov` et `Déc`, suivis de `-AAAA`. Les tirets représentant une absence ne deviennent jamais zéro. Une formule Excel sans résultat scalaire déjà mis en cache est refusée.

## Fiabilité technique

La hiérarchie de preuve est la suivante :

1. octets archivés localement et SHA-256 calculé par le module ;
2. coordonnées ligne/colonne et libellé source de chaque observation ;
3. manifeste CKAN, URL, `ETag` et `Last-Modified` comme métadonnées consultatives ;
4. taille ou hash déclaré par le fournisseur, lorsqu'il existe.

Un hash fournisseur vide n'est jamais interprété comme une preuve d'égalité. Deux téléchargements CKAN ne sont identiques que si leur SHA-256 local est identique. Aucun fichier n'est écrasé à un chemin de digest existant. Pour les exports Google Sheets officiels, un SHA-256 nouveau est archivé mais ne suffit pas à créer une révision : après parsing et qualité, des observations sémantiquement identiques terminent en `no_change`, référencent le dataset courant et ne publient ni dataset ni snapshot. Toute différence de valeur, période, libellé, unité, lieu, source ou clé naturelle reste une modification publiable soumise aux barrières.

Les garde-fous de transport CKAN autorisent uniquement `data.gov.ma` et `www.data.gov.ma`, HTTPS sans identifiants, trois redirections au maximum, 15 secondes par tentative et 4 Mio par artefact. Les feuilles officielles ont leur politique séparée décrite ci-dessus ; aucune n'autorise un hôte, un schéma ou des identifiants arbitraires. Avant ExcelJS, l'archive est limitée à 256 entrées ZIP et 32 Mio déclarés décompressés.

## Cadence et fraîcheur

- fréquence éditoriale attendue : mensuelle ;
- retard normal admis : 45 jours ;
- interrogation recommandée : tous les 7 jours ;
- avertissement : âge supérieur à 60 jours ;
- état périmé : âge supérieur à 120 jours.

Les ressources CKAN observées portent une dernière modification fournisseur du 6 février 2025. Une donnée historique valide reste donc publiable avec `accepted_with_warning` et `source_stale` ; le système ne masque pas son âge. Pour les cinq feuilles officielles, la fraîcheur vient uniquement de la dernière `period_end` analysée, jamais d'un `Last-Modified`, d'un `ETag` absent ou du conditionnement XLSX. La fraîcheur ne doit jamais être confondue avec l'intégrité de l'artefact.

## Barrières de publication

La publication est bloquée si la source est désactivée ou candidate, si la licence ne permet plus l'usage dérivé interne, si le parseur détecte une dérive de schéma, si aucune observation n'est produite, si une clé naturelle porte deux valeurs différentes, si l'unité ou l'année de base est incohérente, si un lieu est inconnu ou si un scalaire n'est pas reproductible.

Les marqueurs manquants, la source tardive ou périmée, le recul de couverture et un nouveau libellé créent des avertissements explicites. Aucun score numérique ne peut annuler l'échec d'une barrière obligatoire.

## Sources non qualifiées

ONP, ONICL, ASAA/MAPMDREF, BAM, métaux, énergie, change, météo et transport restent hors du lot 1 tant qu'une URL officielle stable, une licence, un contrat de structure, une cadence et un test de reprise n'ont pas été qualifiés. Un PDF trouvé ponctuellement ou un site secondaire ne doit pas être ajouté au registre actif.
