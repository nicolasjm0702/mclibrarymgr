<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Cache;

class ModrinthProvider implements LibraryProvider
{
    use ClientOnlyOverrides;

    private const CACHE_TTL = 60 * 60 * 12; // 12 hours

    private Client $http;

    public function __construct()
    {
        $this->http = new Client(['base_uri' => 'https://api.modrinth.com/v2/']);
    }

    public function search(array $params): array
    {
        if ($projectId = $params['project_id'] ?? null) {
            $response = $this->http->get("project/{$projectId}/version");

            return ['versions' => json_decode($response->getBody()->getContents(), true)];
        }

        $facets = [["project_type:" . ($params['type'] ?? 'mod')]];

        $loaders = array_filter(explode(',', $params['loaders'] ?? ''));
        if ($loaders) {
            $facets[] = array_map(fn ($loader) => "categories:{$loader}", $loaders);
        }

        if ($version = $params['version'] ?? null) {
            $facets[] = ["versions:{$version}"];
        }

        $response = $this->http->get('search', [
            'query' => [
                'query' => $params['q'] ?? '',
                'facets' => json_encode($facets),
                'offset' => $params['offset'] ?? 0,
                'limit' => $params['limit'] ?? 15,
            ],
        ]);

        $data = json_decode($response->getBody()->getContents(), true);

        if (($params['type'] ?? 'mod') === 'mod') {
            $data['hits'] = array_values(array_filter(
                $data['hits'] ?? [],
                fn ($hit) => ($hit['server_side'] ?? 'required') !== 'unsupported'
            ));
        }

        return $data;
    }

    public function projectVersions(string $projectId, array $filters): array
    {
        $query = [];
        $loaders = array_filter(explode(',', $filters['loaders'] ?? ''));
        if ($loaders) {
            $query['loaders'] = json_encode(array_values($loaders));
        }
        if ($version = $filters['version'] ?? null) {
            $query['game_versions'] = json_encode([$version]);
        }

        $response = $this->http->get("project/{$projectId}/version", ['query' => $query]);

        return json_decode($response->getBody()->getContents(), true);
    }

    public function resolveInstallFile(array $installParams): array
    {
        if ($versionId = $installParams['version_id'] ?? null) {
            $response = $this->http->get("project/{$installParams['project_id']}/version/{$versionId}");
            $file = json_decode($response->getBody()->getContents(), true)['files'][0];

            return $this->withSha1($file);
        }

        $versions = $this->projectVersions($installParams['project_id'], $installParams);

        if (empty($versions)) {
            throw new \RuntimeException('No version matches the selected game version and loader.');
        }

        return $this->withSha1($versions[0]['files'][0]);
    }

    private function withSha1(array $file): array
    {
        $file['sha1'] = $file['hashes']['sha1'] ?? null;

        return $file;
    }

    public function identifyByHashes(array $hashesByKey): array
    {
        $result = array_fill_keys(array_keys($hashesByKey), null);
        if (!$hashesByKey) {
            return $result;
        }

        try {
            $versionsByHash = json_decode($this->http->post('version_files', [
                'json' => ['hashes' => array_values($hashesByKey), 'algorithm' => 'sha1'],
            ])->getBody()->getContents(), true);

            $projectIds = array_values(array_unique(array_column($versionsByHash, 'project_id')));
            if (!$projectIds) {
                return $result;
            }

            $projectsById = array_column(
                json_decode($this->http->get('projects', [
                    'query' => ['ids' => json_encode($projectIds)],
                ])->getBody()->getContents(), true),
                null,
                'id'
            );
        } catch (\Exception $exception) {
            return $result;
        }

        foreach ($hashesByKey as $key => $hash) {
            $project = $projectsById[$versionsByHash[$hash]['project_id'] ?? null] ?? null;
            if ($project) {
                $result[$key] = [
                    'project_id' => $project['id'],
                    'slug' => $project['slug'],
                    'title' => $project['title'],
                    'description' => $project['description'],
                    'icon_url' => $project['icon_url'],
                    'downloads' => $project['downloads'],
                ];
            }
        }

        return $result;
    }

    public function searchModpacks(array $params): array
    {
        $facets = [['project_type:modpack']];

        if ($version = $params['version'] ?? null) {
            $facets[] = ["versions:{$version}"];
        }

        if ($loader = $params['loader'] ?? null) {
            $facets[] = ["categories:{$loader}"];
        }

        $response = $this->http->get('search', [
            'query' => [
                'query' => $params['q'] ?? '',
                'facets' => json_encode($facets),
                'offset' => $params['offset'] ?? 0,
                'limit' => $params['limit'] ?? 15,
            ],
        ]);

        $data = json_decode($response->getBody()->getContents(), true);
        $data['hits'] = array_map(function ($hit) {
            $hit['loaders'] = array_values(array_intersect(
                $hit['categories'] ?? [],
                ['fabric', 'forge', 'neoforge', 'quilt']
            ));

            return $hit;
        }, $data['hits'] ?? []);

        return $data;
    }

    public function projectInfo(string $projectId): ?array
    {
        return Cache::remember("mclibrarymgr:modrinth:projectinfo:{$projectId}", self::CACHE_TTL, function () use ($projectId) {
            try {
                $project = json_decode(
                    $this->http->get("project/{$projectId}")->getBody()->getContents(),
                    true
                );

                return [
                    'project_id' => $project['id'],
                    'slug' => $project['slug'],
                    'title' => $project['title'],
                    'description' => $project['description'],
                    'project_type' => $project['project_type'],
                    'icon_url' => $project['icon_url'],
                    'downloads' => $project['downloads'],
                ];
            } catch (\Exception $exception) {
                return null;
            }
        });
    }

    public function modpackManifest(array $installParams): array
    {
        $projectId = $installParams['project_id'];
        $versionId = $installParams['version_id'];

        $version = json_decode(
            $this->http->get("project/{$projectId}/version/{$versionId}")->getBody()->getContents(),
            true
        );

        $file = $version['files'][0];

        $archivePath = tempnam(sys_get_temp_dir(), 'mclibrarymgr_');
        $this->http->get($file['url'], ['sink' => $archivePath]);

        $zip = new \ZipArchive();
        $zip->open($archivePath);

        $index = json_decode($zip->getFromName('modrinth.index.json'), true);

        $entries = [];
        $downloadHashes = [];
        foreach ($index['files'] as $indexEntry) {
            if (($indexEntry['env']['server'] ?? 'required') === 'unsupported') {
                continue;
            }

            $entries[] = [
                'path' => $indexEntry['path'],
                'kind' => 'download',
                'url' => $indexEntry['downloads'][0],
            ];

            if ($sha1 = $indexEntry['hashes']['sha1'] ?? null) {
                $downloadHashes[$indexEntry['path']] = $sha1;
            }
        }

        try {
            if ($downloadHashes) {
                $versionsByHash = json_decode($this->http->post('version_files', [
                    'json' => ['hashes' => array_values($downloadHashes), 'algorithm' => 'sha1'],
                ])->getBody()->getContents(), true);

                $projectIdByHash = array_map(fn ($version) => $version['project_id'], $versionsByHash);
                $projectIds = array_values(array_unique($projectIdByHash));

                if ($projectIds) {
                    $projects = json_decode($this->http->get('projects', [
                        'query' => ['ids' => json_encode($projectIds)],
                    ])->getBody()->getContents(), true);

                    $serverSideByProject = array_column($projects, 'server_side', 'id');

                    $clientOnlyPaths = [];
                    foreach ($downloadHashes as $path => $hash) {
                        $projectId = $projectIdByHash[$hash] ?? null;
                        if ($projectId && ($serverSideByProject[$projectId] ?? 'required') === 'unsupported') {
                            $clientOnlyPaths[$path] = true;
                        }
                    }

                    $entries = array_values(array_filter(
                        $entries,
                        fn ($entry) => !($entry['kind'] === 'download' && isset($clientOnlyPaths[$entry['path']]))
                    ));
                }
            }
        } catch (\Exception $exception) {
            // Best-effort verification only — an API hiccup here shouldn't block the install.
        }

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);

            if (substr($name, -1) === '/' || str_starts_with($name, 'client-overrides/')) {
                continue;
            }

            foreach (['overrides/', 'server-overrides/'] as $prefix) {
                if (!str_starts_with($name, $prefix)) {
                    continue;
                }

                $relativePath = substr($name, strlen($prefix));
                if (self::isClientOnlyOverride($relativePath)) {
                    continue;
                }

                $entries[] = [
                    'path' => $relativePath,
                    'kind' => 'override',
                    'zip_name' => $name,
                ];
            }
        }

        $zip->close();

        return [
            'name' => $index['name'] ?? $version['name'] ?? 'Modpack',
            'version_number' => $version['version_number'],
            'archive_path' => $archivePath,
            'entries' => $entries,
        ];
    }
}
