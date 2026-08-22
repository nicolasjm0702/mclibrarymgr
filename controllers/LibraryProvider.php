<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

interface LibraryProvider
{
    public function search(array $params): array;

    public function projectVersions(string $projectId, array $filters): array;

    public function resolveInstallFile(array $installParams): array;

    /**
     * $hashesByKey is [caller key => sha1], returns [caller key => project
     * info or null] — one round trip to the provider for the whole batch.
     */
    public function identifyByHashes(array $hashesByKey): array;

    public function searchModpacks(array $params): array;

    public function modpackManifest(array $installParams): array;

    public function projectInfo(string $projectId): ?array;
}
