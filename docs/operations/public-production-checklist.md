# Checklist de mise en production publique

Cette checklist constitue la preuve synthétique de préparation et d'activation. Elle ne doit contenir ni secret, ni valeur de jeton, ni journal complet. Chaque case est cochée uniquement avec une référence vérifiable : commande, SHA, identifiant ou URL publique.

## Audit avant exposition publique

- [x] Inventaire de tous les fichiers de chaque objet Git atteignable effectué (`git rev-list --objects --all`) : 82 chemins de blobs distincts, plus gros blob de 162 550 octets, aucun export ou binaire métier.
- [x] Recherche de motifs de secrets effectuée sur tout l'historique : seuls les noms de variables, patrons documentaires et credentials factices des tests ont été relevés.
- [x] Revue humaine de l'historique public initial achevée : un commit socle et un commit fonctionnel, aucune ascendance privée, auteurs `noreply`, aucune donnée ERP, société ou personne. Les seules chaînes de credentials sont des fixtures de tests explicitement factices.
- [x] Dépôt privé source confirmé comme `Faroukoo/shared-data-forecast-hub` ; cible publique autorisée le 2026-08-27 sous `Faroukoo/shared-data-forecast-hub-public`.
- [x] État Git source propre contrôlé sur `codex/data-hub-free-production` ; les arbres socle et fonctionnel du nouvel historique correspondent byte pour byte aux arbres validés.

Décision de confidentialité : quatre commits de l'archive privée exposent une adresse d'auteur personnelle. Ils ne sont pas présents dans la cible publique. Son historique commence par un commit socle et un commit fonctionnel attribués à l'adresse GitHub `noreply` ; seuls des commits documentaires de preuve peuvent ensuite s'y ajouter. L'archive d'origine reste privée et inchangée.

## Validation locale

- [x] Suite complète réussie : 101 tests sur 101.
- [x] Typage TypeScript réussi.
- [x] Lint réussi sans avertissement.
- [x] Build réussi sous Node `22.22.3` et npm `11.15.0`.
- [x] Audit sans vulnérabilité haute ou critique : une basse et deux modérées restent connues. Elles concernent le serveur de développement esbuild sous Windows et `uuid` transitif via ExcelJS ; ni serveur de développement ni API UUID concernée ne sont utilisés par l'ingestion de production.
- [x] État officiel reconstruit dans `/tmp` depuis les deux sources qualifiées, validation réussie, deux snapshots byte-identiques, restauration vers une cible vide et revalidation réussies. Snapshot `d09a89994ba6a8c3aad7a76d4e7844f12c6cffcd32159f3434079dc8a6da275a`, archive SHA-256 `fb573d5a31d4da6ee1d567e0562707a68c59c3bf8d3e84c9d022ee331ebc3287`.
- [x] Répertoire source préservé : digest agrégé inchangé `4f2f880cca4fb93c399d3a38199da8c7eb986f943608fdb46fb64f7135ae3262` avant et après l'exercice.

Écart de reprise : la copie historique locale a été rejetée sans modification, car deux anciens runs `quarantined` n'ont pas de rapport qualité associé. Aucune preuve n'a été inventée et le validateur n'a pas été affaibli. La reconstruction vierge a récupéré les mêmes deux artefacts officiels SHA-256, puis une exécution après restauration a retourné `no_change` pour les deux sources. Le bootstrap distant devra être construit depuis cet état officiel reconstruit et non depuis les runs historiques incomplets.

## GitHub public et intégration

- [x] Visibilité `PUBLIC` confirmée pour <https://github.com/Faroukoo/shared-data-forecast-hub-public> ; l'archive source reste `PRIVATE`.
- [x] Pull Request brouillon créée : <https://github.com/Faroukoo/shared-data-forecast-hub-public/pull/1>.
- [x] CI de préparation réussie sur le SHA public `a9e549473f4292d07f3dcde7a4f74fd0d7d25955`, run `33060088750`.
- [x] Revue finale sans défaut bloquant, PR #1 fusionnée par squash au SHA exact `f036a04fa21a061113afd135763679c17767e3f5` ; CI `main` réussie sur ce SHA, run `33060355443`.
- [x] Variable `DATA_HUB_PRODUCTION_ENABLED` absente pendant toute la préparation.

## Bootstrap et reprise distante

- [x] Release bootstrap brouillon créée sous l'identifiant numérique exact `377715698`, tag `data-20260827T095123Z-9d3b77bbfc0c`, snapshot `9d3b77bbfc0cf05cbc0f2e27f24cfb0b348ce0e5d71b09267fbd7ce67657e226`.
- [x] La release bootstrap contient exactement trois assets : index, archive et sidecar SHA-256.
- [x] Les trois digests distants correspondent aux fichiers locaux vérifiés : index `48028a7fd288d32136705a0d3abe0dde438fc931e356a4bd5f0fb81f613173e3`, archive `889fadd8457628b1bc7f24aa4ac2b91de215da12e09b62ae289383c9b50d5b26`, sidecar `e865057b270a48a4109b487b864859d95f7f7220664dd0ab8ee7c56e6658bebc`.
- [x] Publication du brouillon effectuée uniquement par le mode manuel `publish-bootstrap` avec son identifiant exact ; run réussi `33060492978` sur le SHA fusionné.
- [x] Téléchargement sans `GITHUB_TOKEN` ni `GH_TOKEN` des trois assets prouvé dans un répertoire temporaire neuf depuis les URLs publiques de la release.
- [x] Restauration anonyme vers un chemin vide et `verify-state` réussis : deux sources, deux datasets et `contains_confidential_data=false`.
- [x] Exécution manuelle `refresh` sans changement réussie, run `33060620502` : décision `no_change` pour deux sources et une release publique avant comme après.

## Activation et coût

- [x] Aucune ressource Supabase ou Vercel n'a été créée pour ce lot.
- [x] Aucun serveur résident, conteneur, runner auto-hébergé, cache ou artifact Actions n'a été créé pour ce lot ; les conteneurs ERP-Snack préexistants sont restés intacts.
- [x] Variable `DATA_HUB_PRODUCTION_ENABLED=true` activée seulement après toutes les preuves précédentes.
- [x] Workflow `Verified public data refresh` actif, identifiant `343652402`, planifié le lundi à `05:17 Europe/Paris`. Les deux sources HCP sont intègres mais `stale` ; les incidents de fraîcheur restent visibles dans les issues #2 et #3 sans altérer ni republier les valeurs.
