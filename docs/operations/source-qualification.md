# Qualification des sources — lot 1 HCP

## Périmètre et décision

Le lot 1 autorise uniquement deux séries mensuelles publiées par le Haut-Commissariat au Plan sur `data.gov.ma`. Elles peuvent alimenter les indicateurs macro des projets consommateurs, mais elles ne remplacent pas les prix d'achat réels, les factures fournisseurs ou les stocks de l'ERP Snack.

| Source | Dataset CKAN | Ressource XLSX | Usage |
| --- | --- | --- | --- |
| `hcp-ipc-2017-monthly` | `0ebb73ec-1f04-4854-b73e-a7868b0b18b0` | `6b44bd34-87ca-479b-b8e6-460f184269fb` | IPC base 100 en 2017, national et 18 villes |
| `hcp-ipp-2018-monthly` | `59a68619-4bd8-4086-8bea-5a0e4757b4d8` | `1af2d785-b1c4-45c8-9194-b3e745a2deca` | Indices des prix à la production base 100 en 2018, national |

API commune : `https://data.gov.ma/data/api/3/action/`.

Fichiers qualifiés :

- IPC : `https://data.gov.ma/data/dataset/0ebb73ec-1f04-4854-b73e-a7868b0b18b0/resource/6b44bd34-87ca-479b-b8e6-460f184269fb/download/i_7.5.xlsx` ;
- IPP : `https://data.gov.ma/data/fr/dataset/59a68619-4bd8-4086-8bea-5a0e4757b4d8/resource/1af2d785-b1c4-45c8-9194-b3e745a2deca/download/i_7.7.xlsx`.

Les pages dataset servent de preuve de licence ODbL 1.0. L'usage interne dérivé et la redistribution sont autorisés selon la déclaration du portail. Toute modification de licence bloque la publication jusqu'à une nouvelle qualification humaine.

## Contrat fournisseur observé

Le classeur IPC contient les feuilles `Data` et `Metadata`. L'en-tête métier est à la ligne 4 : `Villes`, `Divisions et groupes de produits`, une colonne annuelle ignorée, puis les mois à partir de la colonne 4. La feuille de métadonnées doit déclarer une périodicité mensuelle, l'unité `Indice` et le HCP comme source. Les lieux sont limités au national et aux 18 villes explicitement enregistrées ; aucun rapprochement approximatif n'est permis.

Le classeur IPP utilise le même contrat de feuilles et de métadonnées. La première colonne est `Secteurs`, les autres colonnes utiles sont mensuelles et la géographie est nationale. Les secteurs sont normalisés en clés stables, tandis que le libellé source original reste conservé.

Les mois admis sont exactement `Janv`, `Févr`, `Mars`, `Avr`, `Mai`, `Juin`, `Juill`, `Août`, `Sept`, `Oct`, `Nov` et `Déc`, suivis de `-AAAA`. Les tirets représentant une absence ne deviennent jamais zéro. Une formule Excel sans résultat scalaire déjà mis en cache est refusée.

## Fiabilité technique

La hiérarchie de preuve est la suivante :

1. octets archivés localement et SHA-256 calculé par le module ;
2. coordonnées ligne/colonne et libellé source de chaque observation ;
3. manifeste CKAN, URL, `ETag` et `Last-Modified` comme métadonnées consultatives ;
4. taille ou hash déclaré par le fournisseur, lorsqu'il existe.

Un hash fournisseur vide n'est jamais interprété comme une preuve d'égalité. Deux téléchargements ne sont identiques que si leur SHA-256 local est identique. Aucun fichier n'est écrasé à un chemin de digest existant.

Les garde-fous de transport autorisent uniquement `data.gov.ma` et `www.data.gov.ma`, HTTPS sans identifiants, trois redirections au maximum, 15 secondes par tentative et 4 Mio par artefact. Avant ExcelJS, l'archive est limitée à 256 entrées ZIP et 32 Mio déclarés décompressés.

## Cadence et fraîcheur

- fréquence éditoriale attendue : mensuelle ;
- retard normal admis : 45 jours ;
- interrogation recommandée : tous les 7 jours ;
- avertissement : âge supérieur à 60 jours ;
- état périmé : âge supérieur à 120 jours.

Les ressources observées portent une dernière modification fournisseur du 6 février 2025. Une donnée historique valide reste donc publiable avec `accepted_with_warning` et `source_stale` ; le système ne masque pas son âge. La fraîcheur ne doit jamais être confondue avec l'intégrité de l'artefact.

## Barrières de publication

La publication est bloquée si la source est désactivée ou candidate, si la licence ne permet plus l'usage dérivé interne, si le parseur détecte une dérive de schéma, si aucune observation n'est produite, si une clé naturelle porte deux valeurs différentes, si l'unité ou l'année de base est incohérente, si un lieu est inconnu ou si un scalaire n'est pas reproductible.

Les marqueurs manquants, la source tardive ou périmée, le recul de couverture et un nouveau libellé créent des avertissements explicites. Aucun score numérique ne peut annuler l'échec d'une barrière obligatoire.

## Sources non qualifiées

ONP, ONICL, ASAA/MAPMDREF, BAM, métaux, énergie, change, météo et transport restent hors du lot 1 tant qu'une URL officielle stable, une licence, un contrat de structure, une cadence et un test de reprise n'ont pas été qualifiés. Un PDF trouvé ponctuellement ou un site secondaire ne doit pas être ajouté au registre actif.
