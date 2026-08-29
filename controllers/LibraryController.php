<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Pterodactyl\BlueprintFramework\Libraries\ExtensionLibrary\Client\BlueprintClientLibrary;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Models\Server;
use Pterodactyl\Repositories\Wings\DaemonCommandRepository;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;

class LibraryController extends Controller
{
    private const PAGE_SIZE = 15;

    private const FOLDERS = [
        'mod' => '/mods',
        'plugin' => '/plugins',
        'datapack' => '/world/datapacks',
        'resourcepack' => '/resourcepacks',
    ];

    private LibraryProvider $provider;
    private bool $providerReady = true;
    private string $providerName;
    private bool $enabled;

    public function __construct(
        private DaemonFileRepository $fileRepository,
        private DaemonCommandRepository $commandRepository,
        private BlueprintClientLibrary $blueprint,
    ) {
        $this->providerName = $blueprint->dbGet('mclibrarymgr', 'provider', 'modrinth');
        $this->providerReady = LibraryProviderRegistry::isAvailable($this->providerName, $blueprint);
        $this->provider = LibraryProviderRegistry::make($this->providerName, $blueprint);
        $this->enabled = $blueprint->dbGet('mclibrarymgr', 'library_enabled', '1') !== '0';
    }

    private function guardEnabled(): ?JsonResponse
    {
        return $this->enabled
            ? null
            : new JsonResponse(['message' => 'The Library tab has been disabled by an administrator.'], 403);
    }

    public function provider(): JsonResponse
    {
        return new JsonResponse([
            'provider' => $this->providerName,
            'sources' => LibraryProviderRegistry::list($this->blueprint),
            'libraryEnabled' => $this->enabled,
            'modpackEnabled' => $this->blueprint->dbGet('mclibrarymgr', 'modpack_enabled', '1') !== '0',
        ]);
    }

    public function setProvider(Request $request): JsonResponse
    {
        $provider = $request->input('provider');
        if (!in_array($provider, LibraryProviderRegistry::ids(), true)) {
            return new JsonResponse(['message' => "Unknown provider: {$provider}"], 422);
        }

        $this->blueprint->dbSet('mclibrarymgr', 'provider', $provider);

        return new JsonResponse(['message' => 'ok']);
    }

    public function search(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        $page = max(1, (int) $request->query('page', 1));

        try {
            return new JsonResponse($this->provider->search([
                'project_id' => $request->query('project_id'),
                'q' => $request->query('q', ''),
                'type' => $request->query('type', 'mod'),
                'loaders' => $request->query('loaders', ''),
                'version' => $request->query('version'),
                'offset' => ($page - 1) * self::PAGE_SIZE,
                'limit' => self::PAGE_SIZE,
            ]));
        } catch (RequestException $exception) {
            return $this->upstreamError($exception);
        }
    }

    public function versions(): JsonResponse
    {
        try {
            $http = new Client();
            $response = $http->get('https://launchermeta.mojang.com/mc/game/version_manifest.json');
            $manifest = json_decode($response->getBody()->getContents(), true);

            $releases = array_values(array_map(
                fn ($v) => $v['id'],
                array_filter($manifest['versions'], fn ($v) => $v['type'] === 'release')
            ));

            return new JsonResponse(['versions' => $releases]);
        } catch (RequestException $exception) {
            return $this->upstreamError($exception);
        }
    }

    public function installed(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        $type = $request->query('type');
        if (!array_key_exists($type, self::FOLDERS)) {
            return new JsonResponse(['message' => "Unknown type: {$type}"], 422);
        }

        if ($type === 'resourcepack') {
            $record = $this->blueprint->dbGet('mclibrarymgr', "resourcepack:{$server->uuid}", null);
            if ($record === null) {
                return new JsonResponse(['files' => []]);
            }

            return new JsonResponse(['files' => [[
                'name' => $record['filename'],
                'size' => 0,
                'project_id' => $record['project_id'] ?? null,
            ]]]);
        }

        try {
            $entries = $this->fileRepository->setServer($server)->getDirectory(self::FOLDERS[$type]);
        } catch (\Exception $exception) {
            // Folder doesn't exist yet on a fresh server — nothing installed.
            return new JsonResponse(['files' => []]);
        }

        $files = array_values(array_filter($entries, fn ($entry) => $entry['file'] ?? false));

        return new JsonResponse(['files' => $files]);
    }

    public function details(Request $request): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        $projectId = $request->query('project_id');
        $info = $projectId ? $this->provider->projectInfo($projectId) : null;

        if ($info === null) {
            return new JsonResponse(['message' => 'Project not found.'], 404);
        }

        return new JsonResponse($info);
    }

    public function identifyBatch(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        $type = $request->input('type');
        if (!array_key_exists($type, self::FOLDERS)) {
            return new JsonResponse(['message' => "Unknown type: {$type}"], 422);
        }

        if ($type === 'resourcepack') {
            return new JsonResponse(['message' => 'Resource packs are identified directly, not by hash.'], 422);
        }

        // Individual mod jars regularly run 30-100MB; hashing one fully in
        // memory can exceed PHP's default 128M limit on its own.
        // ponytail: bumped per-request, raise further (or stream-hash) if this stops being enough.
        ini_set('memory_limit', '512M');

        $repository = $this->fileRepository->setServer($server);

        $hashesByFilename = [];
        foreach ($request->input('filenames', []) as $filename) {
            try {
                $content = $repository->getContent(self::FOLDERS[$type] . '/' . $filename, 200 * 1024 * 1024);
                $hashesByFilename[$filename] = $this->provider->hashContent($content);
            } catch (\Exception $exception) {
                // Unreadable — left out of the batch, frontend treats a
                // missing key the same as "not identified".
            }
        }

        $results = $this->provider->identifyByHashes($hashesByFilename);

        $loaders = $request->input('loaders', '');
        $version = $request->input('version');

        foreach ($results as $filename => $project) {
            if ($project === null) {
                continue;
            }

            $results[$filename]['project_type'] = $type;
            $results[$filename]['has_update'] = false;
            $results[$filename]['latest_version'] = null;

            try {
                $versions = $this->provider->projectVersions($project['project_id'], [
                    'loaders' => $loaders,
                    'version' => $version,
                ]);
            } catch (\Exception $exception) {
                continue; // Best-effort — an update check failure shouldn't break identify.
            }

            $latest = $versions[0] ?? null;
            if ($latest === null) {
                continue;
            }

            $installedHash = $hashesByFilename[$filename] ?? null;
            $latestHashes = array_column($latest['files'] ?? [], 'sha1');
            // No sha1 on CurseForge's projectVersions files array unless
            // resolveInstallFile filled it in — Modrinth's files always carry it.
            $latestHashes = array_filter($latestHashes);

            $results[$filename]['has_update'] = $installedHash !== null
                && $latestHashes !== []
                && !in_array($installedHash, $latestHashes, true);
            $results[$filename]['latest_version'] = $latest['version_number'] ?? null;
        }

        return new JsonResponse(['results' => $results]);
    }

    public function uninstall(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        $type = $request->input('type');
        if (!array_key_exists($type, self::FOLDERS)) {
            return new JsonResponse(['message' => "Unknown type: {$type}"], 422);
        }

        if ($type === 'resourcepack') {
            $this->configureResourcePack($server, null, null);
            $this->blueprint->dbSet('mclibrarymgr', "resourcepack:{$server->uuid}", null);

            return new JsonResponse(['message' => 'ok']);
        }

        $filename = $request->input('filename');

        if ($type === 'datapack') {
            // Disable before deleting — disabling after the file is gone
            // errors as "unknown datapack".
            $this->tryDatapackCommand($server, 'disable', $filename);
        }

        try {
            $this->fileRepository->setServer($server)->deleteFiles(self::FOLDERS[$type], [$filename]);
        } catch (\Exception $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 502);
        }

        return new JsonResponse(['message' => 'ok']);
    }

    public function install(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        $type = $request->input('type');
        if (!array_key_exists($type, self::FOLDERS)) {
            return new JsonResponse(['message' => "Unknown type: {$type}"], 422);
        }

        try {
            $file = $this->provider->resolveInstallFile([
                'project_id' => $request->input('project_id'),
                'version_id' => $request->input('version_id'),
                'loaders' => $request->input('loaders', ''),
                'version' => $request->input('version'),
            ]);
        } catch (RequestException $exception) {
            return $this->upstreamError($exception);
        } catch (\RuntimeException $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 404);
        }

        if ($type === 'resourcepack') {
            if (empty($file['url'])) {
                return new JsonResponse(['message' => 'This resource pack is not available for direct download from its source.'], 502);
            }

            $this->configureResourcePack($server, $file['url'], $file['sha1'] ?? null);
            $this->blueprint->dbSet('mclibrarymgr', "resourcepack:{$server->uuid}", [
                'project_id' => $request->input('project_id'),
                'filename' => $file['filename'],
            ]);

            return new JsonResponse(['message' => 'ok', 'warning' => null]);
        }

        try {
            $this->fileRepository->setServer($server)->pull($file['url'], self::FOLDERS[$type], [
                'filename' => $file['filename'],
            ]);
        } catch (\Exception $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 502);
        }

        if ($type === 'datapack') {
            // pull() downloads in the background
            sleep(2);
            $this->tryDatapackCommand($server, 'enable', $file['filename']);
        }

        return new JsonResponse(['message' => 'ok', 'warning' => null]);
    }

    private function tryDatapackCommand(Server $server, string $action, string $filename): void
    {
        $safeFilename = str_replace('"', '\\"', $filename);

        try {
            $this->commandRepository->setServer($server)->send("datapack {$action} \"file/{$safeFilename}\"");
        } catch (\Exception $exception) {
            // server offline, or (on install) the file isn't downloaded yet.
        }
    }

    // The server never serves its own /resourcepacks folder to clients — the
    // direct provider CDN URL used to download the file here is what actually
    // gets handed to clients via server.properties, same URL either way.
    private function configureResourcePack(Server $server, ?string $url, ?string $sha1): void
    {
        $this->setServerProperties($server, [
            'resource-pack' => $url ?? '',
            'resource-pack-sha1' => $sha1 ?? '',
        ]);
    }

    private function setServerProperties(Server $server, array $properties): void
    {
        $repository = $this->fileRepository->setServer($server);

        try {
            $content = $repository->getContent('/server.properties', 5 * 1024 * 1024);
        } catch (\Exception $exception) {
            $content = '';
        }

        $keys = array_keys($properties);
        $lines = array_values(array_filter(
            $content === '' ? [] : explode("\n", $content),
            fn ($line) => !array_filter($keys, fn ($key) => str_starts_with($line, "{$key}="))
        ));

        foreach ($properties as $key => $value) {
            $lines[] = "{$key}={$value}";
        }

        $repository->putContent('/server.properties', implode("\n", $lines));
    }

    private function upstreamError(RequestException $exception): JsonResponse
    {
        $message = $exception->getResponse()
            ? $exception->getResponse()->getBody()->getContents()
            : $exception->getMessage();

        return new JsonResponse(['message' => $message], 502);
    }
}
