<div class="row">
    <div class="col-md-12">
        <div class="box">
            <div class="box-header with-border">
                <h3 class="box-title">Minecraft Library Manager</h3>
            </div>

            <form action="{{ $root }}" method="POST">
                <div class="box-body">
                    <p>
                        Adds a "Library" tab to every server's sidebar for searching and
                        installing mods, plugins, datapacks and resource packs. The
                        provider (Modrinth or CurseForge) is switched from that tab
                        itself &mdash; this page only holds the CurseForge API key.
                    </p>

                    <div class="form-group">
                        <label class="form-label">Library tab</label>
                        <div>
                            <div class="radio radio-success radio-inline">
                                <input type="radio" id="pLibraryEnabled" value="1" name="library_enabled" @if($libraryEnabled) checked @endif>
                                <label for="pLibraryEnabled">Enabled</label>
                            </div>
                            <div class="radio radio-danger radio-inline">
                                <input type="radio" id="pLibraryDisabled" value="0" name="library_enabled" @if(!$libraryEnabled) checked @endif>
                                <label for="pLibraryDisabled">Disabled</label>
                            </div>
                        </div>
                        <p class="text-muted small" style="margin-top: 5px;">
                            Hides mods/plugins/datapacks/resource packs search &amp; install on every server's Library tab.
                        </p>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Modpack tab</label>
                        <div>
                            <div class="radio radio-success radio-inline">
                                <input type="radio" id="pModpackEnabled" value="1" name="modpack_enabled" @if($modpackEnabled) checked @endif>
                                <label for="pModpackEnabled">Enabled</label>
                            </div>
                            <div class="radio radio-danger radio-inline">
                                <input type="radio" id="pModpackDisabled" value="0" name="modpack_enabled" @if(!$modpackEnabled) checked @endif>
                                <label for="pModpackDisabled">Disabled</label>
                            </div>
                        </div>
                        <p class="text-muted small" style="margin-top: 5px;">
                            Hides modpack search &amp; install on every server's Modpack tab.
                        </p>
                    </div>

                    <div class="form-group">
                        <label for="pCurseForgeApiKey" class="form-label">CurseForge API key</label>
                        <input
                            type="text"
                            id="pCurseForgeApiKey"
                            name="curseforge_api_key"
                            class="form-control"
                            value="{{ $curseforgeApiKey }}"
                            placeholder="Required only if a server switches its Library tab to CurseForge"
                        />
                        <p class="text-muted small" style="margin-top: 5px;">
                            This must be a 3rd-party read API key, not a Console "Personal Access
                            Token" &mdash; those are for CurseForge's own studio/publish tools and
                            will be rejected here. Apply for the right key at
                            <a href="https://forms.monday.com/forms/dce5ccb7afda9a1c21dab1a1aa1d84eb?r=use1" target="_blank" rel="noopener">
                                CurseForge's 3rd-party API request form
                            </a>.
                        </p>
                    </div>
                </div>

                <div class="box-footer">
                    {!! csrf_field() !!}
                    {!! method_field('PATCH') !!}

                    <button type="submit" class="btn btn-sm btn-primary pull-right">Save</button>
                </div>
            </form>
        </div>
    </div>
</div>
