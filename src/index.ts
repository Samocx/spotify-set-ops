const clientId = "cad0d776db134bef964d8a66e6e4ca8b";

const url_params = new URLSearchParams(window.location.search);
const url_code = url_params.get("code");
const redirectUri = "http://127.0.0.1:8080";

const scope = "user-read-private "
            + "user-read-email "

            + "playlist-read-private "
            + "playlist-modify-private "
            + "playlist-modify-public";

class SpotifyAuth {

    private readonly verifierLength: number = 128;
    private verifier: string = ''; 
    private accessToken: string = '';

    constructor(
        private readonly clientId: string,

        private readonly url_code: string,
        private readonly redirectUri: string,

        private readonly scope: string
    ) {}
    
    // authenification durch spotify
    async redirectToLogin(): Promise<void> {
        this.generateCodeVerifier(this.verifierLength);
        const challenge = await this.generateCodeChallenge();

        localStorage.setItem("verifier", this.verifier);

        const params = new URLSearchParams();
        params.append("client_id", this.clientId);
        params.append("response_type", "code");
        params.append("redirect_uri", this.redirectUri);
        params.append("scope", this.scope);
        params.append("code_challenge_method", "S256");
        params.append("code_challenge", challenge);

        document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
    }

    generateCodeVerifier(length: number) {
        let text = '';
        let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        this.verifier = text;
    }

    async generateCodeChallenge() {
        const data = new TextEncoder().encode(this.verifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async authenticate() {
        const verifier = localStorage.getItem("verifier");

        const params = new URLSearchParams();
        params.append("client_id", this.clientId);
        params.append("grant_type", "authorization_code");
        params.append("code", this.url_code!);
        params.append("redirect_uri", this.redirectUri);
        params.append("code_verifier", verifier!);

        const result = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const responseText = await result.text();
        console.log("token status:", result.status);
        // console.log("token body:", responseText);

        if (!result.ok) {
            throw new Error(`Token request failed: ${result.status} ${responseText}`);
        }

        let payload: any;
        try {
            payload = JSON.parse(responseText);
        } catch (error) {
            throw new Error(`Invalid JSON from token endpoint: ${responseText}`);
        }

        const { access_token } = payload;
        if (!access_token) {
            throw new Error(`No access token in token response: ${responseText}`);
        }
        this.accessToken = access_token;
    }

    GetAccessToken(): string {
        if (!this.accessToken) {
            throw new Error("Not authenticated");
        }

        return this.accessToken;
    }
}

class SpotifyApiClient {
    constructor(private readonly accessToken: string) {}

    async fetchProfile(): Promise<any> {
        const result = await fetch("https://api.spotify.com/v1/me", {
            method: "GET", headers: { Authorization: `Bearer ${this.accessToken}` }
        });

        return await result.json();
    }

    async fetchPlaylists(): Promise<any> {
        const playlists: any[] = [];
        let nextUrl: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
        let total = 0;

        while (nextUrl) {
            const result: Response = await fetch(nextUrl, {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            });

            if (!result.ok) {
                const errorBody = await result.text();
                throw new Error(`Failed to fetch playlists: ${result.status} ${errorBody}`);
            }

            const page: any = await result.json();
            playlists.push(...page.items);
            total = page.total;
            nextUrl = page.next;
        }

        return {
            items: playlists,
            total,
            next: null
        };
    }

    async fetchPlaylist(playlist_id: string): Promise<any> {
        const result = await fetch(`https://api.spotify.com/v1/playlists/${playlist_id}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${this.accessToken}` }
        });

        if (!result.ok) {
            const errorBody = await result.text();
            throw new Error(`Failed to fetch playlist: ${result.status} ${errorBody}`);
        }

        return await result.json();
    }

    async getPlaylistSet(playlist_id: string): Promise<Set<string>> {
        const playlist = await this.fetchPlaylist(playlist_id);
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

            const result = await fetch(trackPage.next, {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            });

            if (!result.ok) {
                const errorBody = await result.text();
                throw new Error(`Failed to fetch playlist tracks: ${result.status} ${errorBody}`);
            }

            trackPage = await result.json();
        }

        return trackSet;
    }

    async createPlaylistBySet(name: string, description: string, set: Set<string>) {
        const userProfile = await this.fetchProfile();
        const userId = userProfile.id;

        // Create new playlist
        const createPlaylistResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: name,
                description: description,
                public: false,
                collaborative: false
            })
        });

        if (!createPlaylistResponse.ok) {
            const errorBody = await createPlaylistResponse.text();
            throw new Error(`Failed to create playlist: ${createPlaylistResponse.status} ${errorBody}`);
        }

        const newPlaylist = await createPlaylistResponse.json();
        const newPlaylistId = newPlaylist.id;

        // Add tracks to new playlist in batches
        const trackUris = Array.from(set).map(id => `spotify:track:${id}`);
        for (let i = 0; i < trackUris.length; i += 100) {
            const batch = trackUris.slice(i, i + 100);
            const addTracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ uris: batch })
            });

            if (!addTracksResponse.ok) {
                const errorBody = await addTracksResponse.text();
                throw new Error(`Failed to add tracks: ${addTracksResponse.status} ${errorBody}`);
            }
        }
    }
}

enum SetOperation {
    Union = "union",
    Intersection = "intersection",
    Difference = "difference",
    SymmetricDifference = "symmetric-difference"
}

const maxPlaylistNameLength = 100;

// on site load
(async () => {
    const auth = new SpotifyAuth(clientId, url_code!, redirectUri, scope);
    const status = document.getElementById("status")!;

    if (!url_code) {
        setStatus(status, "Redirecting to Spotify for authentication...", "loading");
        await auth.redirectToLogin();
    } else {
        try {
            setStatus(status, "Loading your profile and playlists...", "loading");

            const alreadyUsed = sessionStorage.getItem("spotify_code_used");
            if (alreadyUsed === url_code) {
                window.history.replaceState({}, document.title, window.location.pathname);
                await auth.redirectToLogin();
                return;
            }

            sessionStorage.setItem("spotify_code_used", url_code);
            await auth.authenticate();

            const api = new SpotifyApiClient(auth.GetAccessToken());
            const profile = await api.fetchProfile();
            const playlists = await api.fetchPlaylists();

            populateProfileUI(profile);
            populatePlaylistsUI(playlists);
            setStatus(status, "Ready.", "success");
        } catch (error) {
            const message = error instanceof Error ? error.message : "An unexpected error occurred.";
            setStatus(status, `Could not load Spotify data: ${message}`, "error");
        }
    }

    const applyOpsButton = document.getElementById("apply-ops") as HTMLButtonElement;
    applyOpsButton.addEventListener("click", () => {
        handleApplyOperation(auth, status, applyOpsButton);
    });
})();

async function handleApplyOperation(auth: SpotifyAuth, status: HTMLElement, applyOpsButton: HTMLButtonElement): Promise<void> {
    if (applyOpsButton.disabled) {
        return;
    }

    const set1Select = document.getElementById("set1") as HTMLSelectElement;
    const set2Select = document.getElementById("set2") as HTMLSelectElement;
    const operationSelect = document.getElementById("set-operation") as HTMLSelectElement;
    const set1Id = set1Select.value;
    const set2Id = set2Select.value;
    const operation = operationSelect.value as SetOperation;

    if (!set1Id || !set2Id) {
        setStatus(status, "Please select both playlists.", "error");
        return;
    }

    applyOpsButton.disabled = true;
    const api = new SpotifyApiClient(auth.GetAccessToken());
    let playlistName = "";
    let resultSet = new Set<string>();
    const newPlaylistDescription = "Created by Spotify Set Operations App";

    try {
        setStatus(status, "Loading playlist tracks...", "loading");
        const set1 = await api.getPlaylistSet(set1Id);
        const set2 = await api.getPlaylistSet(set2Id);
        resultSet = applySetOperation(set1, set2, operation);

        const operationSymbol = getOperationSymbol(operation);
        playlistName = `(${set1Select.selectedOptions[0].textContent} ${operationSymbol} ${set2Select.selectedOptions[0].textContent})`;

        if (playlistName.length > maxPlaylistNameLength) {
            const shouldCrop = window.confirm(
                `The playlist name is ${playlistName.length} characters long. Crop it to ${maxPlaylistNameLength} characters?`
            );

            if (!shouldCrop) {
                setStatus(status, "Operation cancelled: the playlist name is too long.", "error");
                return;
            }

            playlistName = playlistName.slice(0, maxPlaylistNameLength);
        }

        setStatus(status, `Creating playlist with ${resultSet.size} tracks...`, "loading");
        await api.createPlaylistBySet(playlistName, newPlaylistDescription, resultSet);
        setStatus(status, `Playlist created successfully with ${resultSet.size} tracks.`, "success");
    } catch (error) {
        if (isPlaylistNameTooLongError(error) && playlistName.length > maxPlaylistNameLength) {
            const croppedName = playlistName.slice(0, maxPlaylistNameLength);
            const shouldCrop = window.confirm(
                `The playlist name is too long. Crop it to ${maxPlaylistNameLength} characters and retry?`
            );

            if (shouldCrop) {
                try {
                    setStatus(status, "Retrying with a shortened playlist name...", "loading");
                    await api.createPlaylistBySet(croppedName, newPlaylistDescription, resultSet);
                    setStatus(status, `Playlist created successfully with ${resultSet.size} tracks.`, "success");
                    return;
                } catch (retryError) {
                    error = retryError;
                }
            }
        }

        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        setStatus(status, `Operation failed: ${message}`, "error");
    } finally {
        applyOpsButton.disabled = false;
    }
}

function isPlaylistNameTooLongError(error: unknown): boolean {
    return error instanceof Error
        && error.message.includes("too long playlist name");
}

function setStatus(element: HTMLElement, message: string, state: "loading" | "success" | "error"): void {
    element.textContent = message;
    element.dataset.state = state;

    const loader = document.getElementById("loader");
    loader?.toggleAttribute("hidden", state !== "loading");
}

function populateProfileUI(profile: any) {
    const imageUrl = profile.images?.[0]?.url;
    const displayName = document.getElementById("displayName")!;
    const avatar = document.getElementById("avatar") as HTMLAnchorElement;

    displayName.innerText = profile.display_name ?? 'Spotify User';
    avatar.innerHTML = '';

    if (imageUrl) {
        const profileImage = new Image(100, 100);
        profileImage.src = imageUrl;
        avatar.appendChild(profileImage);
    }

    if (profile.external_urls?.spotify) {
        const spotifyUrl = profile.external_urls.spotify;
        avatar.setAttribute('href', spotifyUrl);
    }
}

function populatePlaylistsUI(playlists: any) {
    const set1 = document.getElementById("set1") as HTMLSelectElement;
    const set2 = document.getElementById("set2") as HTMLSelectElement;

    set1.innerHTML = "";
    set2.innerHTML = "";

    for (const playlist of playlists.items) {
        const option1 = createPlaylistOption(playlist);
        const option2 = createPlaylistOption(playlist);

        set1.appendChild(option1);
        set2.appendChild(option2);
    }

    updatePlaylistImage(set1);
    updatePlaylistImage(set2);
    set1.addEventListener("change", () => updatePlaylistImage(set1));
    set2.addEventListener("change", () => updatePlaylistImage(set2));
}

function createPlaylistOption(playlist: any): HTMLOptionElement {
    const option = document.createElement("option");

    option.value = playlist.id;
    option.textContent =
        `${playlist.name} (${playlist.tracks?.total ?? 0})`;

    option.dataset.imageUrl =
        playlist.images?.[0]?.url ?? "";

    return option;
}

function updatePlaylistImage(select: HTMLSelectElement): void {
    const image = document.getElementById(`${select.id}-image`) as HTMLImageElement;
    const imageUrl = select.selectedOptions[0]?.dataset.imageUrl ?? "";

    image.src = imageUrl;
    image.hidden = !imageUrl;
}

function getOperationSymbol(operation: SetOperation): string {
    switch (operation) {
        case SetOperation.Union:
            return "∪";
        case SetOperation.Intersection:
            return "∩";
        case SetOperation.Difference:
            return "∖";
        case SetOperation.SymmetricDifference:
            return "△";
    }
}

function applySetOperation(set1: Set<string>, set2: Set<string>, operation: SetOperation) {
    let resultSet = new Set<string>();
    
    switch (operation) {
        case SetOperation.Union:
            resultSet = new Set([...set1, ...set2]);
            break;
        case SetOperation.Intersection:
            resultSet = new Set([...set1].filter(x => set2.has(x)));
            break;
        case SetOperation.Difference:
            resultSet = new Set([...set1].filter(x => !set2.has(x)));
            break;
        case SetOperation.SymmetricDifference:
            resultSet = new Set([...set1, ...set2].filter(x => !(set1.has(x) && set2.has(x))));
            break;
    }
    return resultSet;
}
