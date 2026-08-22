<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;

class CurseForgeProvider implements LibraryProvider
{
    use ClientOnlyOverrides;

    private const CACHE_TTL = 60 * 60 * 12; // 12 hours

    private const GAME_ID = 432; // Minecraft

    // CurseForge class IDs per https://docs.curseforge.com/rest-api/#tocS_Category
    private const CLASS_IDS = [
        'mod' => 6,
        'plugin' => 5,
        'datapack' => 6945,
        'resourcepack' => 12,
    ];

    private const MODPACK_CLASS_ID = 4471;

    // CurseForge ModLoaderType enum per https://docs.curseforge.com/rest-api/#tocS_ModLoaderType
    private const MOD_LOADER_TYPES = [
        'forge' => 1,
        'fabric' => 4,
        'quilt' => 5,
        'neoforge' => 6,
    ];

    private Client $http;

    public function __construct(string $apiKey)
    {
        $this->http = new Client([
            'base_uri' => 'https://api.curseforge.com/v1/',
            'headers' => ['x-api-key' => $apiKey],
        ]);
    }

    public function search(array $params): array
    {
        if ($projectId = $params['project_id'] ?? null) {
            return ['versions' => $this->projectVersions($projectId, $params)];
        }

        $query = [
            'gameId' => self::GAME_ID,
            'classId' => self::CLASS_IDS[$params['type'] ?? 'mod'],
            'searchFilter' => $params['q'] ?? '',
            'index' => $params['offset'] ?? 0,
            'pageSize' => $params['limit'] ?? 15,
        ];

        if ($version = $params['version'] ?? null) {
            $query['gameVersion'] = $version;
        }

        $response = $this->http->get('mods/search', ['query' => $query]);
        $data = json_decode($response->getBody()->getContents(), true);

        $hits = array_map(fn ($mod) => [
            'project_id' => (string) $mod['id'],
            'slug' => $mod['slug'],
            'title' => $mod['name'],
            'description' => $mod['summary'],
            'project_type' => $params['type'] ?? 'mod',
            'icon_url' => $mod['logo']['url'] ?? null,
            'author' => $mod['authors'][0]['name'] ?? null,
            'downloads' => $mod['downloadCount'],
        ], $data['data']);

        // CurseForge has no per-project client/server-only field in its
        // public API — no equivalent filter here (known gap, see ModrinthProvider).
        return ['hits' => $hits, 'total_hits' => $data['pagination']['totalCount'] ?? count($hits)];
    }

    public function projectVersions(string $projectId, array $filters): array
    {
        $query = [];
        if ($version = $filters['version'] ?? null) {
            $query['gameVersion'] = $version;
        }

        $response = $this->http->get("mods/{$projectId}/files", ['query' => $query]);
        $data = json_decode($response->getBody()->getContents(), true);

        $loaders = array_filter(explode(',', $filters['loaders'] ?? ''));

        $files = $data['data'];
        if ($loaders) {
            $files = array_values(array_filter($files, function ($file) use ($loaders) {
                $fileLoaders = array_map('strtolower', $file['gameVersions'] ?? []);

                return array_intersect(array_map('strtolower', $loaders), $fileLoaders) !== [];
            }));
        }

        return array_map(fn ($file) => [
            'id' => (string) $file['id'],
            'version_number' => $file['displayName'],
            'game_versions' => $file['gameVersions'],
            'loaders' => array_values(array_intersect(
                $file['gameVersions'],
                ['Forge', 'Fabric', 'NeoForge', 'Quilt', 'Paper', 'Spigot', 'Purpur', 'Bukkit', 'Folia', 'Velocity', 'Waterfall', 'BungeeCord']
            )),
            'files' => [[
                'url' => $file['downloadUrl'],
                'filename' => $file['fileName'],
                'sha1' => $this->sha1FromHashes($file),
            ]],
        ], $files);
    }

    // CurseForge HashAlgo enum: 1 = Sha1, 2 = Md5.
    private function sha1FromHashes(array $file): ?string
    {
        foreach ($file['hashes'] ?? [] as $hash) {
            if (($hash['algo'] ?? null) === 1) {
                return $hash['value'];
            }
        }

        return null;
    }

    public function resolveInstallFile(array $installParams): array
    {
        if ($fileId = $installParams['version_id'] ?? null) {
            $response = $this->http->get("mods/{$installParams['project_id']}/files/{$fileId}");
            $file = json_decode($response->getBody()->getContents(), true)['data'];

            return [
                'url' => $file['downloadUrl'],
                'filename' => $file['fileName'],
                'sha1' => $this->sha1FromHashes($file),
            ];
        }

        $versions = $this->projectVersions($installParams['project_id'], $installParams);

        if (empty($versions)) {
            throw new \RuntimeException('No version matches the selected game version and loader.');
        }

        return $versions[0]['files'][0];
    }

    public function identifyByHashes(array $hashesByKey): array
    {
        $result = array_fill_keys(array_keys($hashesByKey), null);
        if (!$hashesByKey) {
            return $result;
        }

        $fingerprintByKey = array_map(fn ($sha1) => (int) hexdec(substr($sha1, 0, 8)), $hashesByKey);

        try {
            $matches = json_decode($this->http->post('fingerprints/432', [
                'json' => ['fingerprints' => array_values(array_unique($fingerprintByKey))],
            ])->getBody()->getContents(), true)['data']['exactMatches'] ?? [];

            $modIdByFingerprint = [];
            foreach ($matches as $match) {
                $modIdByFingerprint[$match['file']['fileFingerprint']] = $match['id'];
            }

            $modIds = array_values(array_unique($modIdByFingerprint));
            if (!$modIds) {
                return $result;
            }

            $modsById = array_column(
                json_decode($this->http->post('mods', [
                    'json' => ['modIds' => $modIds],
                ])->getBody()->getContents(), true)['data'],
                null,
                'id'
            );
        } catch (\Exception $exception) {
            return $result;
        }

        foreach ($fingerprintByKey as $key => $fingerprint) {
            $mod = $modsById[$modIdByFingerprint[$fingerprint] ?? null] ?? null;
            if ($mod) {
                $result[$key] = [
                    'project_id' => (string) $mod['id'],
                    'slug' => $mod['slug'],
                    'title' => $mod['name'],
                    'description' => $mod['summary'],
                    'icon_url' => $mod['logo']['url'] ?? null,
                    'downloads' => $mod['downloadCount'],
                ];
            }
        }

        return $result;
    }

    public function searchModpacks(array $params): array
    {
        $query = [
            'gameId' => self::GAME_ID,
            'classId' => self::MODPACK_CLASS_ID,
            'searchFilter' => $params['q'] ?? '',
            'index' => $params['offset'] ?? 0,
            'pageSize' => $params['limit'] ?? 15,
        ];

        if ($version = $params['version'] ?? null) {
            $query['gameVersion'] = $version;
        }

        if ($loader = $params['loader'] ?? null) {
            if ($loaderType = self::MOD_LOADER_TYPES[$loader] ?? null) {
                $query['modLoaderType'] = $loaderType;
            }
        }

        $response = $this->http->get('mods/search', ['query' => $query]);
        $data = json_decode($response->getBody()->getContents(), true);

        $hits = array_map(fn ($mod) => [
            'project_id' => (string) $mod['id'],
            'slug' => $mod['slug'],
            'title' => $mod['name'],
            'description' => $mod['summary'],
            'project_type' => 'modpack',
            'icon_url' => $mod['logo']['url'] ?? null,
            'author' => $mod['authors'][0]['name'] ?? null,
            'downloads' => $mod['downloadCount'],
            'loaders' => array_values(array_intersect(
                array_map(fn ($c) => strtolower($c['name'] ?? ''), $mod['categories'] ?? []),
                array_keys(self::MOD_LOADER_TYPES)
            )),
        ], $data['data']);

        return ['hits' => $hits, 'total_hits' => $data['pagination']['totalCount'] ?? count($hits)];
    }

    public function projectInfo(string $projectId): ?array
    {
        return Cache::remember("mclibrarymgr:curseforge:projectinfo:{$projectId}", self::CACHE_TTL, function () use ($projectId) {
            try {
                $mod = json_decode(
                    $this->http->get("mods/{$projectId}")->getBody()->getContents(),
                    true
                )['data'];

                return [
                    'project_id' => (string) $mod['id'],
                    'slug' => $mod['slug'],
                    'title' => $mod['name'],
                    'description' => $mod['summary'],
                    'project_type' => 'modpack',
                    'icon_url' => $mod['logo']['url'] ?? null,
                    'downloads' => $mod['downloadCount'],
                ];
            } catch (\Exception $exception) {
                return null;
            }
        });
    }

    public function modpackManifest(array $installParams): array
    {
        $projectId = $installParams['project_id'];
        $fileId = $installParams['version_id'];

        $file = json_decode(
            $this->http->get("mods/{$projectId}/files/{$fileId}")->getBody()->getContents(),
            true
        )['data'];

        $archivePath = tempnam(sys_get_temp_dir(), 'mclibrarymgr_');
        $this->http->get($file['downloadUrl'], ['sink' => $archivePath]);

        $zip = new \ZipArchive();
        $zip->open($archivePath);

        $manifest = json_decode($zip->getFromName('manifest.json'), true);

        $modRefs = array_values(array_filter(
            $manifest['files'],
            fn ($ref) => $ref['required'] ?? true
        ));

        $entries = [];
        if ($modRefs) {
            $response = $this->http->post('mods/files', [
                'json' => ['fileIds' => array_map(fn ($ref) => $ref['fileID'], $modRefs)],
            ]);
            $files = json_decode($response->getBody()->getContents(), true)['data'];

            foreach ($files as $modFile) {
                $entries[] = [
                    'path' => 'mods/' . $modFile['fileName'],
                    'kind' => 'download',
                    'url' => $modFile['downloadUrl'],
                ];
            }
        }

        $overridesFolder = rtrim($manifest['overrides'] ?? 'overrides', '/') . '/';
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);

            if (substr($name, -1) === '/' || !str_starts_with($name, $overridesFolder)) {
                continue;
            }

            $relativePath = substr($name, strlen($overridesFolder));
            if (self::isClientOnlyOverride($relativePath)) {
                continue;
            }

            $entries[] = [
                'path' => $relativePath,
                'kind' => 'override',
                'zip_name' => $name,
            ];
        }

        $zip->close();

        return [
            'name' => $manifest['name'] ?? 'Modpack',
            'version_number' => $manifest['version'] ?? $file['displayName'],
            'archive_path' => $archivePath,
            'entries' => $entries,
        ];
    }
}
