<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

interface LibraryProvider
{
    public function search(array $params): array;

    public function projectVersions(string $projectId, array $filters): array;

    public function resolveInstallFile(array $installParams): array;

    /**
     * Provider-specific content hash used to key identifyByHashes lookups
     * (Modrinth: sha1, CurseForge: its own murmur2-based fingerprint).
     * Callers hash one file at a time and discard its content immediately
     * rather than holding a whole batch of raw file bytes in memory.
     */
    public function hashContent(string $content): string;

    /**
     * $hashesByKey is [caller key => hashContent() result], returns [caller
     * key => project info or null] — one round trip to the provider for the
     * whole batch.
     */
    public function identifyByHashes(array $hashesByKey): array;

    public function searchModpacks(array $params): array;

    public function modpackManifest(array $installParams): array;

    public function projectInfo(string $projectId): ?array;
}
