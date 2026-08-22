# Minecraft Library Manager

Pterodactyl Blueprint extension. Adds a "Library" and "Modpack" tab to the server panel for
searching and installing mods, plugins, datapacks and resource packs from
Modrinth or CurseForge, without leaving the panel. The admin can enable or disable both tabs.

## Installation

1. Drop `mclibrarymgr.blueprint` into your Pterodactyl root folder
   (usually `/var/www/pterodactyl/`).
2. Run:

    ```bash
    blueprint -i mclibrarymgr
    ```

## Removal

```bash
blueprint -r mclibrarymgr
```
