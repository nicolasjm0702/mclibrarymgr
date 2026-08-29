<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;

class CurseForgeProvider implements LibraryProvider
{
    use ClientOnlyOverrides;
    use CachedRequests;

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

        return $this->cached('mclibrarymgr:curseforge:search:' . md5(json_encode($query)), function () use ($query, $params) {
            $response = $this->http->get('mods/search', ['query' => $query]);
            $data = json_decode($response->getBody()->getContents(), true);

            $loaderTypes = array_keys(self::MOD_LOADER_TYPES);
            $type = $params['type'] ?? 'mod';

            $hits = array_map(function ($mod) use ($params, $type, $loaderTypes) {
                $hit = [
                    'project_id' => (string) $mod['id'],
                    'slug' => $mod['slug'],
                    'title' => $mod['name'],
                    'description' => $mod['summary'],
                    'project_type' => $type,
                    'icon_url' => $mod['logo']['url'] ?? null,
                    'author' => $mod['authors'][0]['name'] ?? null,
                    'downloads' => $mod['downloadCount'],
                    'likes' => $mod['thumbsUpCount'] ?? 0,
                    'no_direct_download' => ($mod['allowModDistribution'] ?? true) === false,
                ];

                if (in_array($type, ['mod', 'plugin'], true)) {
                    $hit['loaders'] = array_values(array_intersect(
                        array_map(fn ($c) => strtolower($c['name'] ?? ''), $mod['categories'] ?? []),
                        $loaderTypes
                    ));
                } else {
                    $indexes = $mod['latestFilesIndexes'] ?? [];
                    $wanted = $params['version'] ?? null;
                    $match = $wanted
                        ? current(array_filter($indexes, fn ($i) => ($i['gameVersion'] ?? null) === $wanted))
                        : ($indexes[0] ?? null);
                    $hit['latest_version'] = $match['gameVersion'] ?? ($indexes[0]['gameVersion'] ?? null);
                }

                return $hit;
            }, $data['data']);

            // CurseForge has no per-project client/server-only field in its
            // public API — no equivalent filter here (known gap, see ModrinthProvider).
            return ['hits' => $hits, 'total_hits' => $data['pagination']['totalCount'] ?? count($hits)];
        });
    }

    public function projectVersions(string $projectId, array $filters): array
    {
        $query = [];
        if ($version = $filters['version'] ?? null) {
            $query['gameVersion'] = $version;
        }

        $loaders = array_filter(explode(',', $filters['loaders'] ?? ''));

        return $this->cached(
            "mclibrarymgr:curseforge:projectversions:{$projectId}:" . md5(json_encode($query) . json_encode($loaders)),
            function () use ($projectId, $query, $loaders) {
                $response = $this->http->get("mods/{$projectId}/files", ['query' => $query]);
                $data = json_decode($response->getBody()->getContents(), true);

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
        );
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

            if (empty($file['downloadUrl'])) {
                throw new \RuntimeException('This file\'s author has disabled third-party downloads on CurseForge.');
            }

            return [
                'url' => $this->resolveDirectUrl($file['downloadUrl']),
                'filename' => $file['fileName'],
                'sha1' => $this->sha1FromHashes($file),
            ];
        }

        $versions = $this->projectVersions($installParams['project_id'], $installParams);

        if (empty($versions)) {
            throw new \RuntimeException('No version matches the selected game version and loader.');
        }

        $file = $versions[0]['files'][0];
        if (empty($file['url'])) {
            throw new \RuntimeException('This file\'s author has disabled third-party downloads on CurseForge.');
        }

        return [
            'url' => $this->resolveDirectUrl($file['url']),
            'filename' => $file['filename'],
            'sha1' => $file['sha1'],
        ];
    }

    // CurseForge's CDN (edge.forgecdn.net) 302-redirects to the actual file
    // host; Wings' own downloader rejects non-2xx responses, so we must
    // follow that single hop ourselves before handing the URL off to it.
    private function resolveDirectUrl(string $url): string
    {
        $response = $this->http->get($url, ['allow_redirects' => false, 'stream' => true]);
        $response->getBody()->close();

        if ($response->getStatusCode() >= 300 && $response->getStatusCode() < 400) {
            return $response->getHeaderLine('Location') ?: $url;
        }

        return $url;
    }

    // CurseForge identifies files by its own fingerprint, not sha1: murmur2
    // (seed 1) over the file bytes with whitespace bytes (tab/LF/CR/space)
    // stripped first. https://docs.curseforge.com/rest-api/#fingerprint-match
    private function fingerprint(string $content): int
    {
        $filtered = str_replace(["\x09", "\x0a", "\x0d", "\x20"], '', $content);

        return $this->murmur2($filtered, 1);
    }

    private function murmur32Mul(int $a, int $b): int
    {
        $aLow = $a & 0xFFFF;
        $aHigh = ($a >> 16) & 0xFFFF;
        $bLow = $b & 0xFFFF;
        $bHigh = ($b >> 16) & 0xFFFF;

        $low = $aLow * $bLow;
        $mid = ($aHigh * $bLow + $aLow * $bHigh) & 0xFFFFFFFF;

        return ($low + (($mid & 0xFFFF) << 16)) & 0xFFFFFFFF;
    }

    private function murmur2(string $data, int $seed): int
    {
        $m = 0x5bd1e995;
        $len = strlen($data);
        $h = ($seed ^ $len) & 0xFFFFFFFF;

        $i = 0;
        while ($len - $i >= 4) {
            $k = unpack('V', substr($data, $i, 4))[1];
            $k = $this->murmur32Mul($k, $m);
            $k ^= $k >> 24;
            $k = $this->murmur32Mul($k, $m);

            $h = $this->murmur32Mul($h, $m);
            $h ^= $k;

            $i += 4;
        }

        $remaining = $len - $i;
        if ($remaining === 3) {
            $h ^= ord($data[$i + 2]) << 16;
        }
        if ($remaining >= 2) {
            $h ^= ord($data[$i + 1]) << 8;
        }
        if ($remaining >= 1) {
            $h ^= ord($data[$i]);
            $h = $this->murmur32Mul($h, $m);
        }

        $h ^= $h >> 13;
        $h = $this->murmur32Mul($h, $m);
        $h ^= $h >> 15;

        return $h & 0xFFFFFFFF;
    }

    public function hashContent(string $content): string
    {
        return (string) $this->fingerprint($content);
    }

    public function identifyByHashes(array $hashesByKey): array
    {
        $result = array_fill_keys(array_keys($hashesByKey), null);
        if (!$hashesByKey) {
            return $result;
        }

        $fingerprintByKey = array_map('intval', $hashesByKey);
        $uniqueFingerprints = array_values(array_unique($fingerprintByKey));

        // Cache per fingerprint, not per requested batch — so a later batch
        // that reuses an already-resolved fingerprint only fetches new ones.
        $cacheKeys = array_combine($uniqueFingerprints, array_map(
            fn ($fingerprint) => "mclibrarymgr:curseforge:identify:{$fingerprint}",
            $uniqueFingerprints
        ));

        $cached = Cache::many(array_values($cacheKeys));
        $modByFingerprint = [];
        $missingFingerprints = [];
        foreach ($uniqueFingerprints as $fingerprint) {
            $value = $cached[$cacheKeys[$fingerprint]] ?? null;
            if ($value !== null) {
                $modByFingerprint[$fingerprint] = $value === false ? null : $value;
            } else {
                $missingFingerprints[] = $fingerprint;
            }
        }

        if ($missingFingerprints) {
            try {
                $matches = json_decode($this->http->post('fingerprints/432', [
                    'json' => ['fingerprints' => $missingFingerprints],
                ])->getBody()->getContents(), true)['data']['exactMatches'] ?? [];

                $modIdByFingerprint = [];
                foreach ($matches as $match) {
                    $modIdByFingerprint[$match['file']['fileFingerprint']] = $match['id'];
                }

                $modIds = array_values(array_unique($modIdByFingerprint));
                $modsById = $modIds ? array_column(
                    json_decode($this->http->post('mods', [
                        'json' => ['modIds' => $modIds],
                    ])->getBody()->getContents(), true)['data'],
                    null,
                    'id'
                ) : [];

                $toCache = [];
                foreach ($missingFingerprints as $fingerprint) {
                    $mod = $modsById[$modIdByFingerprint[$fingerprint] ?? null] ?? null;
                    // false = "looked up, no match" sentinel so it's still cached.
                    $entry = $mod ? [
                        'project_id' => (string) $mod['id'],
                        'slug' => $mod['slug'],
                        'title' => $mod['name'],
                        'description' => $mod['summary'],
                        'icon_url' => $mod['logo']['url'] ?? null,
                        'downloads' => $mod['downloadCount'],
                    ] : false;
                    $modByFingerprint[$fingerprint] = $entry === false ? null : $entry;
                    $toCache[$cacheKeys[$fingerprint]] = $entry;
                }
                Cache::putMany($toCache, self::CACHE_TTL);
            } catch (\Exception $exception) {
                // API hiccup — don't cache a failure, just report nothing found this request.
                foreach ($missingFingerprints as $fingerprint) {
                    $modByFingerprint[$fingerprint] = null;
                }
            }
        }

        foreach ($fingerprintByKey as $key => $fingerprint) {
            $result[$key] = $modByFingerprint[$fingerprint] ?? null;
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

        return $this->cached('mclibrarymgr:curseforge:searchmodpacks:' . md5(json_encode($query)), function () use ($query) {
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
                'likes' => $mod['thumbsUpCount'] ?? 0,
                'loaders' => array_values(array_intersect(
                    array_map(fn ($c) => strtolower($c['name'] ?? ''), $mod['categories'] ?? []),
                    array_keys(self::MOD_LOADER_TYPES)
                )),
            ], $data['data']);

            return ['hits' => $hits, 'total_hits' => $data['pagination']['totalCount'] ?? count($hits)];
        });
    }

    public function projectInfo(string $projectId): ?array
    {
        return $this->cached("mclibrarymgr:curseforge:projectinfo:{$projectId}", function () use ($projectId) {
            try {
                $mod = json_decode(
                    $this->http->get("mods/{$projectId}")->getBody()->getContents(),
                    true
                )['data'];

                $loaderTypes = array_keys(self::MOD_LOADER_TYPES);
                $categoryNames = array_map(fn ($c) => strtolower($c['name'] ?? ''), $mod['categories'] ?? []);
                $projectType = array_search($mod['classId'] ?? null, self::CLASS_IDS, true) ?: 'modpack';

                return [
                    'project_id' => (string) $mod['id'],
                    'slug' => $mod['slug'],
                    'title' => $mod['name'],
                    'description' => $mod['summary'],
                    'project_type' => $projectType,
                    'icon_url' => $mod['logo']['url'] ?? null,
                    'downloads' => $mod['downloadCount'],
                    'likes' => $mod['thumbsUpCount'] ?? 0,
                    'categories' => array_values(array_diff($categoryNames, $loaderTypes)),
                    'loaders' => array_values(array_intersect($categoryNames, $loaderTypes)),
                    'game_versions' => array_slice(array_values(array_unique(array_column(
                        $mod['latestFilesIndexes'] ?? [], 'gameVersion'
                    ))), -10),
                    // CurseForge's mod summary is short; fetching the full HTML
                    // description needs a second `mods/{id}/description` call.
                    // reuse the summary instead of the extra round trip
                    'body' => $mod['summary'] ?? '',
                    'updated' => $mod['dateModified'] ?? null,
                    'published' => $mod['dateCreated'] ?? null,
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

        if (empty($file['downloadUrl'])) {
            throw new \RuntimeException('This modpack\'s author has disabled third-party downloads on CurseForge.');
        }

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
        $skipped = [];
        if ($modRefs) {
            $response = $this->http->post('mods/files', [
                'json' => ['fileIds' => array_map(fn ($ref) => $ref['fileID'], $modRefs)],
            ]);
            $files = json_decode($response->getBody()->getContents(), true)['data'];

            foreach ($files as $modFile) {
                if (empty($modFile['downloadUrl'])) {
                    // Author disabled third-party distribution on CurseForge; no URL to pull from.
                    $skipped[] = $modFile['fileName'];
                    continue;
                }

                $entries[] = [
                    'path' => 'mods/' . $modFile['fileName'],
                    'kind' => 'download',
                    'url' => $this->resolveDirectUrl($modFile['downloadUrl']),
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
            'skipped' => $skipped,
        ];
    }
}
