<?php

use Illuminate\Support\Facades\Route;
use Pterodactyl\BlueprintFramework\Extensions\mclibrarymgr;

Route::get('/servers/{server}/provider', [mclibrarymgr\LibraryController::class, 'provider']);
Route::post('/servers/{server}/provider', [mclibrarymgr\LibraryController::class, 'setProvider']);
Route::get('/servers/{server}/search', [mclibrarymgr\LibraryController::class, 'search']);
Route::get('/servers/{server}/versions', [mclibrarymgr\LibraryController::class, 'versions']);
Route::get('/servers/{server}/installed', [mclibrarymgr\LibraryController::class, 'installed']);
Route::post('/servers/{server}/identify-batch', [mclibrarymgr\LibraryController::class, 'identifyBatch']);
Route::post('/servers/{server}/install', [mclibrarymgr\LibraryController::class, 'install']);
Route::delete('/servers/{server}/uninstall', [mclibrarymgr\LibraryController::class, 'uninstall']);

Route::get('/servers/{server}/modpacks/search', [mclibrarymgr\ModpackController::class, 'search']);
Route::get('/servers/{server}/modpacks/versions', [mclibrarymgr\ModpackController::class, 'versions']);
Route::get('/servers/{server}/modpacks/installed', [mclibrarymgr\ModpackController::class, 'installed']);
Route::post('/servers/{server}/modpacks/manifest', [mclibrarymgr\ModpackController::class, 'manifest']);
Route::post('/servers/{server}/modpacks/install-entry', [mclibrarymgr\ModpackController::class, 'installEntry']);
Route::post('/servers/{server}/modpacks/finalize', [mclibrarymgr\ModpackController::class, 'finalize']);
Route::delete('/servers/{server}/modpacks/uninstall', [mclibrarymgr\ModpackController::class, 'uninstall']);
