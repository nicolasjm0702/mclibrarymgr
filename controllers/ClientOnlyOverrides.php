<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

/**
 * Folders inside a modpack's overrides that are always client-only and never
 * meaningful on a dedicated server. Without this, a shaderpack or bundled
 * resourcepack living under `overrides/shaderpacks/` or
 * `overrides/resourcepacks/` gets written straight to the server's
 * filesystem — dead weight the server can't use.
 */
trait ClientOnlyOverrides
{
    private const CLIENT_ONLY_OVERRIDE_DIRS = ['shaderpacks/', 'resourcepacks/'];

    private static function isClientOnlyOverride(string $relativePath): bool
    {
        foreach (self::CLIENT_ONLY_OVERRIDE_DIRS as $dir) {
            if (str_starts_with($relativePath, $dir)) {
                return true;
            }
        }

        return false;
    }
}
