export interface Hit {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    project_type: string;
    icon_url: string | null;
    author?: string;
    downloads: number;
    likes: number;
    loaders?: string[];
    latest_version?: string | null;
    client_only?: boolean;
}

export interface Version {
    id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
}

export interface InstalledEntry {
    name: string;
    size: number;
    project_id?: string;
}

export interface ProjectDetails extends Hit {
    categories: string[];
    game_versions: string[];
    body: string;
    updated: string | null;
    published: string | null;
}
