<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use Pterodactyl\BlueprintFramework\Libraries\ExtensionLibrary\Client\BlueprintClientLibrary;

/**
 * Single place listing every mod/modpack source. Add a new source by adding
 * one entry here (label, the LibraryProvider class, and the settings key
 * holding its API key, if any) — controllers and the frontend selector both
 * read from this list instead of hardcoding provider names.
 */
class LibraryProviderRegistry
{
    private const SOURCES = [
        'modrinth' => [
            'label' => 'Modrinth',
            'class' => ModrinthProvider::class,
            'apiKeySetting' => null,
        ],
        'curseforge' => [
            'label' => 'CurseForge',
            'class' => CurseForgeProvider::class,
            'apiKeySetting' => 'curseforge_api_key',
        ],
    ];

    public static function ids(): array
    {
        return array_keys(self::SOURCES);
    }

    public static function label(string $id): string
    {
        return self::SOURCES[$id]['label'] ?? $id;
    }

    public static function isAvailable(string $id, BlueprintClientLibrary $blueprint): bool
    {
        $apiKeySetting = self::SOURCES[$id]['apiKeySetting'] ?? null;

        return $apiKeySetting === null || self::apiKey($apiKeySetting, $blueprint) !== '';
    }

    private static function apiKey(string $apiKeySetting, BlueprintClientLibrary $blueprint): string
    {
        return $blueprint->dbGet('mclibrarymgr', $apiKeySetting, '') ?? '';
    }

    /**
     * @return array{label: string}[] keyed by source id, plus an "available" flag per entry.
     */
    public static function list(BlueprintClientLibrary $blueprint): array
    {
        $sources = [];
        foreach (self::SOURCES as $id => $source) {
            $sources[] = [
                'id' => $id,
                'label' => $source['label'],
                'available' => self::isAvailable($id, $blueprint),
            ];
        }

        return $sources;
    }

    public static function make(string $id, BlueprintClientLibrary $blueprint): LibraryProvider
    {
        $source = self::SOURCES[$id] ?? self::SOURCES['modrinth'];
        $apiKeySetting = $source['apiKeySetting'] ?? null;
        $class = $source['class'];

        return $apiKeySetting === null
            ? new $class()
            : new $class(self::apiKey($apiKeySetting, $blueprint));
    }
}
