import React from "react";

export interface Source {
    id: string;
    label: string;
    available: boolean;
}

const CURSEFORGE_CATEGORY_SLUGS: Record<string, string> = {
    mod: "mc-mods",
    plugin: "bukkit-plugins",
    datapack: "data-packs",
    resourcepack: "texture-packs",
    modpack: "modpacks",
};

// Each source's public project URL is shaped differently enough (domain,
// category slugs) that there's nothing generic to factor out yet — add a
// branch here when a new source needs one.
export const sourceProjectUrl = (
    provider: string,
    hit: { project_type: string; slug: string },
): string =>
    provider === "curseforge"
        ? `https://www.curseforge.com/minecraft/${CURSEFORGE_CATEGORY_SLUGS[hit.project_type] ?? "mc-mods"}/${hit.slug}`
        : `https://modrinth.com/${hit.project_type}/${hit.slug}`;

interface SourceSelectorProps {
    provider: string;
    sources: Source[];
    onChange: (provider: string) => void;
}

const SourceSelector = ({
    provider,
    sources,
    onChange,
}: SourceSelectorProps) => (
    <>
        <div
            css={{ fontSize: "0.75rem", opacity: 0.6, marginBottom: "0.35rem" }}
        >
            Source
        </div>
        <div
            css={{
                display: "flex",
                gap: "0.25rem",
                marginBottom: "1.5rem",
                flexWrap: "wrap",
            }}
        >
            {sources.map(({ id, label, available }) => {
                const disabled = !available;
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => !disabled && onChange(id)}
                        disabled={disabled}
                        title={
                            disabled
                                ? `${label} API key not configured.`
                                : undefined
                        }
                        className={`px-4 py-2 rounded-full border-0 text-sm font-semibold ${
                            disabled
                                ? "cursor-not-allowed opacity-40 bg-transparent text-neutral-300"
                                : "cursor-pointer"
                        } ${
                            provider === id && !disabled
                                ? "bg-primary-500 text-primary-50"
                                : disabled
                                  ? ""
                                  : "bg-transparent text-neutral-300"
                        }`}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    </>
);

export default SourceSelector;
