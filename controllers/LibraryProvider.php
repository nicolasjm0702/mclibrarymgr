<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

interface LibraryProvider
{
    public function search(array $params): array;

    public function projectVersions(string $projectId, array $filters): array;

    public function resolveInstallFile(array $installParams): array;

    public function identifyByHash(string $sha1): ?array;

    public function searchModpacks(array $params): array;

    public function modpackManifest(array $installParams): array;

    public function projectInfo(string $projectId): ?array;
}
