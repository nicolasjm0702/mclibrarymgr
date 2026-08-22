<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Pterodactyl\BlueprintFramework\Libraries\ExtensionLibrary\Admin\BlueprintAdminLibrary;

return new class extends Migration
{
    public function up(): void
    {
        app(BlueprintAdminLibrary::class)->dbSetMany('mclibrarymgr', [
            'provider' => 'modrinth',
            'curseforge_api_key' => '',
        ]);
    }

    public function down(): void
    {
        DB::table('settings')->where('key', 'like', 'mclibrarymgr::%')->delete();
    }
};
