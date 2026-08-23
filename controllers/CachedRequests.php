<?php

namespace Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

use Illuminate\Support\Facades\Cache;

trait CachedRequests
{
    private const CACHE_TTL = 60 * 60 * 24; // 24 hours

    protected function cached(string $key, callable $fn): mixed
    {
        return Cache::remember($key, self::CACHE_TTL, $fn);
    }
}
