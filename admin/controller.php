<?php

namespace Pterodactyl\Http\Controllers\Admin\Extensions\{identifier};

use Illuminate\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\Factory as ViewFactory;
use Prologue\Alerts\AlertsMessageBag;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Http\Requests\Admin\AdminFormRequest;
use Pterodactyl\BlueprintFramework\Libraries\ExtensionLibrary\Admin\BlueprintAdminLibrary as BlueprintExtensionLibrary;

class {identifier}ExtensionController extends Controller
{
    public function __construct(
        private ViewFactory $view,
        private BlueprintExtensionLibrary $blueprint,
        private AlertsMessageBag $alert,
    ) {}

    public function index(): View
    {
        return $this->view->make('admin.extensions.{identifier}.index', [
            'curseforgeApiKey' => $this->blueprint->dbGet('{identifier}', 'curseforge_api_key'),
            'libraryEnabled' => $this->blueprint->dbGet('{identifier}', 'library_enabled', '1') !== '0',
            'modpackEnabled' => $this->blueprint->dbGet('{identifier}', 'modpack_enabled', '1') !== '0',
            'root' => '/admin/extensions/{identifier}',
            'blueprint' => $this->blueprint,
        ]);
    }

    public function update({identifier}SettingsFormRequest $request): RedirectResponse
    {
        foreach ($request->normalize() as $key => $value) {
            $this->blueprint->dbSet('{identifier}', $key, $value);
        }

        $this->alert->success('Settings saved.')->flash();

        return redirect()->route('admin.extensions.{identifier}.index');
    }
}

class {identifier}SettingsFormRequest extends AdminFormRequest
{
    public function rules(): array
    {
        return [
            'curseforge_api_key' => 'nullable|string',
            'library_enabled' => 'required|in:0,1',
            'modpack_enabled' => 'required|in:0,1',
        ];
    }
}
