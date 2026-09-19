import { SpotifyAuth } from "./spotify-auth";

export class SpotifyApiClient {
    constructor(private readonly auth: SpotifyAuth) {}

    private async request(url: string, options: RequestInit = {}, hasRetried = false): Promise<Response> {
        const headers = new Headers(options.headers);
        headers.set("Authorization", `Bearer ${this.auth.getAccessToken()}`);

        const result = await fetch(url, { ...options, headers });
        if (result.status !== 401 || hasRetried) {
            return result;
        }

        await this.auth.refreshAccessToken();
        return this.request(url, options, true);
    }

    private async parseJsonResponse<T>(response: Response, requestName: string): Promise<T> {
        const responseText = await response.text();

        if (!response.ok) {
            throw new Error(`${requestName} failed: ${response.status} ${responseText}`);
        }

        try {
            return JSON.parse(responseText) as T;
        } catch {
            throw new Error(`${requestName} returned invalid JSON: ${responseText}`);
        }
    }

    async fetchProfile(signal?: AbortSignal): Promise<any> {
        const result = await this.request("https://api.spotify.com/v1/me", {
            method: "GET",
            signal
        });

        return this.parseJsonResponse(result, "Fetching profile");
    }

    async fetchPlaylists(signal?: AbortSignal): Promise<any> {
        const playlists: any[] = [];
        let nextUrl: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
        let total = 0;

        while (nextUrl) {
            const result = await this.request(nextUrl, { signal });
            const page: any = await this.parseJsonResponse(result, "Fetching playlists");
            playlists.push(...page.items);
            total = page.total;
            nextUrl = page.next;
        }

        return { items: playlists, total, next: null };
    }

    async fetchPlaylist(playlistId: string, signal?: AbortSignal): Promise<any> {
        const result = await this.request(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            method: "GET",
            signal
        });

        return this.parseJsonResponse(result, "Fetching playlist");
    }

    async getPlaylistSet(playlistId: string, signal?: AbortSignal): Promise<Set<string>> {
        const playlist = await this.fetchPlaylist(playlistId, signal);
        const trackSet = new Set<string>();
        let trackPage = playlist.tracks;

        while (trackPage) {
            for (const item of trackPage.items) {
                if (item.track && item.track.id) {
                    trackSet.add(item.track.id);
                }
            }

            if (!trackPage.next) {
                break;
            }

            const result = await this.request(trackPage.next, { signal });
            trackPage = await this.parseJsonResponse(result, "Fetching playlist tracks");
        }

        return trackSet;
    }

    async createPlaylist(name: string, description: string, tracks: string[], signal?: AbortSignal): Promise<void> {
        const userProfile = await this.fetchProfile(signal);
        const userId = userProfile.id;
        const createPlaylistResponse = await this.request(`https://api.spotify.com/v1/users/${userId}/playlists`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
                name,
                description,
                public: false,
                collaborative: false
            })
        });

        if (!createPlaylistResponse.ok) {
            const errorBody = await createPlaylistResponse.text();
            throw new Error(`Failed to create playlist: ${createPlaylistResponse.status} ${errorBody}`);
        }

        const newPlaylist = await createPlaylistResponse.json();
        const trackUris = tracks.map(id => `spotify:track:${id}`);
        for (let index = 0; index < trackUris.length; index += 100) {
            const batch = trackUris.slice(index, index + 100);
            const addTracksResponse = await this.request(`https://api.spotify.com/v1/playlists/${newPlaylist.id}/tracks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal,
                body: JSON.stringify({ uris: batch })
            });

            if (!addTracksResponse.ok) {
                const errorBody = await addTracksResponse.text();
                throw new Error(`Failed to add tracks: ${addTracksResponse.status} ${errorBody}`);
            }
        }
    }
}
