# Checklist de mise en production publique

Cette checklist constitue la preuve synthétique de préparation et d'activation. Elle ne doit contenir ni secret, ni valeur de jeton, ni journal complet. Chaque case est cochée uniquement avec une référence vérifiable : commande, SHA, identifiant ou URL publique.

## Audit avant exposition publique

- [x] Inventaire de tous les fichiers de chaque objet Git atteignable effectué (`git rev-list --objects --all`) : 82 chemins de blobs distincts, plus gros blob de 162 550 octets, aucun export ou binaire métier.
- [x] Recherche de motifs de secrets effectuée sur tout l'historique : seuls les noms de variables, patrons documentaires et credentials factices des tests ont été relevés.
- [x] Revue humaine du nouvel historique public achevée : deux commits seulement, aucune ascendance privée, auteurs `noreply`, aucune donnée ERP, société ou personne. Les seules chaînes de credentials sont des fixtures de tests explicitement factices.
- [x] Dépôt privé source confirmé comme `Faroukoo/shared-data-forecast-hub` ; cible publique autorisée le 2026-08-27 sous `Faroukoo/shared-data-forecast-hub-public`.
- [x] État Git source propre contrôlé sur `codex/data-hub-free-production` ; les arbres socle et fonctionnel du nouvel historique correspondent byte pour byte aux arbres validés.

Décision de confidentialité : quatre commits de l'archive privée exposent une adresse d'auteur personnelle. Ils ne seront jamais poussés vers la cible publique. Le nouveau dépôt recevra un historique propre, limité à un commit socle et un commit fonctionnel, tous deux attribués à l'adresse GitHub `noreply`. L'archive d'origine reste privée et inchangée.

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

- [ ] Visibilité publique confirmée après l'audit complet.
- [ ] Pull Request brouillon créée et liée à cette checklist.
- [ ] CI réussie sur le SHA exact de la branche.
- [ ] Revue finale réussie et commit de fusion exact enregistré.
- [x] Variable `DATA_HUB_PRODUCTION_ENABLED` absente pendant toute la préparation.

## Bootstrap et reprise distante

- [ ] Identifiant numérique exact de la release bootstrap brouillon enregistré.
- [ ] La release bootstrap contient exactement trois assets : index, archive et sidecar SHA-256.
- [ ] Les trois digests distants correspondent aux fichiers locaux vérifiés.
- [ ] Publication du brouillon effectuée uniquement par le mode manuel `publish-bootstrap` avec son identifiant exact.
- [ ] Téléchargement anonyme des trois assets prouvé dans un répertoire temporaire neuf.
- [ ] Restauration anonyme vers un chemin vide et `verify-state` réussis.
- [ ] Exécution manuelle `refresh` sans changement prouvée sans création d'une nouvelle release.

## Activation et coût

- [x] Aucune ressource Supabase ou Vercel n'a été créée pour ce lot.
- [x] Aucun serveur résident, conteneur, runner auto-hébergé, cache ou artifact Actions n'a été créé pour ce lot ; les conteneurs ERP-Snack préexistants sont restés intacts.
- [ ] Variable `DATA_HUB_PRODUCTION_ENABLED=true` activée seulement après toutes les preuves précédentes.
- [ ] Workflow hebdomadaire actif et dernier état de santé des deux sources vérifié.
