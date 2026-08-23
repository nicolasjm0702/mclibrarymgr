<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use GuzzleHttp\Exception\RequestException;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Pterodactyl\BlueprintFramework\Libraries\ExtensionLibrary\Client\BlueprintClientLibrary;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Models\Server;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;

class ModpackController extends Controller
{
    private const PAGE_SIZE = 15;

    private LibraryProvider $provider;
    private bool $providerReady = true;
    private string $providerName;
    private bool $enabled;

    public function __construct(
        private DaemonFileRepository $fileRepository,
        private BlueprintClientLibrary $blueprint,
    ) {
        $this->providerName = $blueprint->dbGet('mclibrarymgr', 'provider', 'modrinth');
        $this->providerReady = LibraryProviderRegistry::isAvailable($this->providerName, $blueprint);
        $this->provider = LibraryProviderRegistry::make($this->providerName, $blueprint);
        $this->enabled = $blueprint->dbGet('mclibrarymgr', 'modpack_enabled', '1') !== '0';
    }

    private function guardEnabled(): ?JsonResponse
    {
        return $this->enabled
            ? null
            : new JsonResponse(['message' => 'The Modpack tab has been disabled by an administrator.'], 403);
    }

    public function search(Request $request): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        $page = max(1, (int) $request->query('page', 1));

        try {
            return new JsonResponse($this->provider->searchModpacks([
                'q' => $request->query('q', ''),
                'version' => $request->query('version'),
                'loader' => $request->query('loader'),
                'offset' => ($page - 1) * self::PAGE_SIZE,
                'limit' => self::PAGE_SIZE,
            ]));
        } catch (RequestException $exception) {
            return $this->upstreamError($exception);
        }
    }

    public function versions(Request $request): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        try {
            return new JsonResponse($this->provider->search([
                'project_id' => $request->query('project_id'),
            ]));
        } catch (RequestException $exception) {
            return $this->upstreamError($exception);
        }
    }

    public function manifest(Request $request): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        if (!$this->providerReady) {
            return new JsonResponse(['message' => LibraryProviderRegistry::label($this->providerName) . ' API key not configured.'], 502);
        }

        try {
            $manifest = $this->provider->modpackManifest([
                'project_id' => $request->input('project_id'),
                'version_id' => $request->input('version_id'),
            ]);
        } catch (RequestException $exception) {
            return $this->upstreamError($exception);
        } catch (\RuntimeException $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 404);
        }

        $token = bin2hex(random_bytes(16));

        file_put_contents($this->sidecarPath($token), json_encode([
            'archive_path' => $manifest['archive_path'],
            'entries' => $manifest['entries'],
        ]));

        return new JsonResponse([
            'token' => $token,
            'name' => $manifest['name'],
            'version_number' => $manifest['version_number'],
            'entries' => array_map(
                fn ($entry) => array_diff_key($entry, ['zip_name' => true]),
                $manifest['entries']
            ),
        ]);
    }

    public function installEntry(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        $token = $request->input('token');
        $path = $request->input('path');

        if (str_contains($path, '..') || str_starts_with($path, '/')) {
            return new JsonResponse(['message' => 'Invalid path.'], 422);
        }

        $sidecarPath = $this->sidecarPath($token);
        if (!file_exists($sidecarPath)) {
            return new JsonResponse(['message' => 'Unknown token.'], 404);
        }

        $sidecar = json_decode(file_get_contents($sidecarPath), true);
        $entry = null;
        foreach ($sidecar['entries'] as $candidate) {
            if ($candidate['path'] === $path) {
                $entry = $candidate;
                break;
            }
        }

        if ($entry === null) {
            return new JsonResponse(['message' => 'Unknown entry.'], 404);
        }

        try {
            if ($entry['kind'] === 'download') {
                $directory = dirname($path);
                $directory = $directory === '.' ? '/' : '/' . $directory;

                $this->fileRepository->setServer($server)->pull($entry['url'], $directory, [
                    'filename' => basename($path),
                    'foreground' => true,
                ]);
            } else {
                $zip = new \ZipArchive();
                $zip->open($sidecar['archive_path']);
                $bytes = $zip->getFromName($entry['zip_name']);
                $zip->close();

                $this->fileRepository->setServer($server)->putContent('/' . $path, $bytes);
            }
        } catch (\Exception $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 502);
        }

        return new JsonResponse(['message' => 'ok']);
    }

    public function finalize(Request $request, Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        $token = $request->input('token');
        $sidecarPath = $this->sidecarPath($token);

        if (file_exists($sidecarPath)) {
            $sidecar = json_decode(file_get_contents($sidecarPath), true);
            @unlink($sidecar['archive_path']);
            @unlink($sidecarPath);
        }

        $this->blueprint->dbSet('mclibrarymgr', "modpack:{$server->uuid}", [
            'project_id' => $request->input('project_id'),
            'name' => $request->input('name'),
            'version_number' => $request->input('version_number'),
            'paths' => $request->input('paths', []),
            'installed_at' => now()->toIso8601String(),
        ]);

        return new JsonResponse(['message' => 'ok']);
    }

    public function uninstall(Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        $record = $this->blueprint->dbGet('mclibrarymgr', "modpack:{$server->uuid}", null);

        if ($record === null) {
            return new JsonResponse(['message' => 'Nothing installed.'], 404);
        }

        $paths = $record['paths'] ?? [];

        $filenamesByDirectory = [];
        foreach ($paths as $path) {
            $directory = dirname($path);
            $directory = $directory === '.' ? '/' : '/' . $directory;
            $filenamesByDirectory[$directory][] = basename($path);
        }

        try {
            foreach ($filenamesByDirectory as $directory => $filenames) {
                $this->fileRepository->setServer($server)->deleteFiles($directory, $filenames);
            }
        } catch (\Exception $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 502);
        }

        $this->blueprint->dbSet('mclibrarymgr', "modpack:{$server->uuid}", null);

        return new JsonResponse(['message' => 'ok', 'removed' => count($paths)]);
    }

    public function installed(Server $server): JsonResponse
    {
        if ($response = $this->guardEnabled()) {
            return $response;
        }

        $record = $this->blueprint->dbGet('mclibrarymgr', "modpack:{$server->uuid}", null);

        if ($record === null) {
            return new JsonResponse(['installed' => false]);
        }

        $info = $this->providerReady && ($record['project_id'] ?? null)
            ? $this->provider->projectInfo($record['project_id'])
            : null;

        return new JsonResponse(array_merge(['installed' => true], $record, $info ?? []));
    }

    private function sidecarPath(string $token): string
    {
        return sys_get_temp_dir() . "/mclibrarymgr_modpack_{$token}.json";
    }

    private function upstreamError(RequestException $exception): JsonResponse
    {
        $message = $exception->getResponse()
            ? $exception->getResponse()->getBody()->getContents()
            : $exception->getMessage();

        return new JsonResponse(['message' => $message], 502);
    }
}
