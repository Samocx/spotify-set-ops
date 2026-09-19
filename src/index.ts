const clientId = "cad0d776db134bef964d8a66e6e4ca8b";

const url_params = new URLSearchParams(window.location.search);
const url_code = url_params.get("code");
const redirectUri = "http://127.0.0.1:8080";

const scope = "user-read-private "
            + "user-read-email "

            + "playlist-read-private "
            + "playlist-modify-private "
            + "playlist-modify-public";

const reuseStoredSession = true;

import { SpotifyAuth } from "./spotify-auth";
import { SpotifyApiClient } from "./spotify-api-client";

enum SetOperation {
    Union = "union",
    Intersection = "intersection",
    Difference = "difference",
    SymmetricDifference = "symmetric-difference"
}

enum PlaylistOrder {
    Default = "default",
    Interlaced = "interlaced",
    Random = "random"
}

const maxPlaylistNameLength = 100;
let activeOperationController: AbortController | null = null;
let playlistRefreshInProgress = false;

// on site load
(async () => {
    const auth = new SpotifyAuth(clientId, url_code, redirectUri, scope);
    const status = document.getElementById("status")!;

    try {
        setStatus(status, "Loading your Spotify session...", "loading");

        if (url_code) {
            await auth.authenticate();
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (reuseStoredSession && auth.hasRefreshToken()) {
            await auth.refreshAccessToken();
        } else {
            setStatus(status, "Redirecting to Spotify for authentication...", "loading");
            await auth.redirectToLogin();
            return;
        }

        await loadSpotifyData(auth, status);
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        setStatus(status, `Could not load Spotify data: ${message}`, "error");
    }

    const applyOpsButton = document.getElementById("apply-ops") as HTMLButtonElement;
    const cancelButton = document.getElementById("cancel-operation") as HTMLButtonElement;
    const set1 = document.getElementById("set1") as HTMLSelectElement;
    const set2 = document.getElementById("set2") as HTMLSelectElement;

    applyOpsButton.addEventListener("click", () => {
        handleApplyOperation(auth, status, applyOpsButton, cancelButton);
    });
    cancelButton.addEventListener("click", () => {
        activeOperationController?.abort();
    });
    set1.addEventListener("click", () => {
        refreshplaylists(auth, status, set1, set2);
    });
    set2.addEventListener("click", () => {
        refreshplaylists(auth, status, set1, set2);
    });
})();

async function loadSpotifyData(auth: SpotifyAuth, status: HTMLElement): Promise<void> {
    setStatus(status, "Loading your profile and playlists...", "loading");
    const api = new SpotifyApiClient(auth);
    const profile = await api.fetchProfile();
    const playlists = await api.fetchPlaylists();

    populateProfileUI(profile);
    populatePlaylistsUI(playlists);
    setStatus(status, "Ready.", "success");
}

async function handleApplyOperation(
    auth: SpotifyAuth,
    status: HTMLElement,
    applyOpsButton: HTMLButtonElement,
    cancelOperationButton: HTMLButtonElement
): Promise<void> {
    if (applyOpsButton.disabled) {
        return;
    }

    const set1Select = document.getElementById("set1") as HTMLSelectElement;
    const set2Select = document.getElementById("set2") as HTMLSelectElement;
    const operationSelect = document.getElementById("set-operation") as HTMLSelectElement;
    const orderSelect = document.getElementById("set-order") as HTMLSelectElement;
    const set1Id = set1Select.value;
    const set2Id = set2Select.value;
    const operation = operationSelect.value as SetOperation;
    const order = orderSelect.value as PlaylistOrder;

    if (!set1Id || !set2Id) {
        setStatus(status, "Please select both playlists.", "error");
        return;
    }

    applyOpsButton.disabled = true;
    cancelOperationButton.disabled = false;
    const controller = new AbortController();
    activeOperationController = controller;
    const api = new SpotifyApiClient(auth);
    let playlistName = "";
    let resultSet = new Set<string>();
    let orderedTracks: string[] = [];
    const newPlaylistDescription = "Created by Spotify Set Operations App";

    try {
        setStatus(status, "Loading playlist tracks...", "loading");
        const set1 = await api.getPlaylistSet(set1Id, controller.signal);
        const set2 = await api.getPlaylistSet(set2Id, controller.signal);
        resultSet = applySetOperation(set1, set2, operation);

        const operationSymbol = getOperationSymbol(operation);
        playlistName = `(${set1Select.selectedOptions[0].textContent} ${operationSymbol} ${set2Select.selectedOptions[0].textContent})`;
        orderedTracks = orderPlaylistTracks(set1, set2, resultSet, order);

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
        await api.createPlaylist(playlistName, newPlaylistDescription, orderedTracks, controller.signal);
        refreshplaylists(auth, status);
        setStatus(status, `Playlist created successfully with ${resultSet.size} tracks.`, "success");
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            setStatus(status, "Operation cancelled.", "error");
        } else if (isPlaylistNameTooLongError(error) && playlistName.length > maxPlaylistNameLength) {
            const croppedName = playlistName.slice(0, maxPlaylistNameLength);
            const shouldCrop = window.confirm(
                `The playlist name is too long. Crop it to ${maxPlaylistNameLength} characters and retry?`
            );

            if (shouldCrop) {
                try {
                    setStatus(status, "Retrying with a shortened playlist name...", "loading");
                    await api.createPlaylist(croppedName, newPlaylistDescription, orderedTracks, controller.signal);
                    refreshplaylists(auth, status);
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
        cancelOperationButton.disabled = true;
        activeOperationController = null;
    }
}

function isPlaylistNameTooLongError(error: unknown): boolean {
    return error instanceof Error
        && error.message.includes("too long playlist name");
}

async function refreshplaylists(auth: SpotifyAuth, status: HTMLElement, set1?: HTMLSelectElement, set2?: HTMLSelectElement): Promise<void> {
    if (playlistRefreshInProgress) {
        return;
    }

    playlistRefreshInProgress = true;
    const selectedSet1 = set1?.value;
    const selectedSet2 = set2?.value;

    setStatus(status, "Refreshing playlists...", "loading");
    const api = new SpotifyApiClient(auth);
    try {
        const playlists = await api.fetchPlaylists();
        populatePlaylistsUI(playlists);

        if (set1 && selectedSet1 && Array.from(set1.options).some(option => option.value === selectedSet1)) {
            set1.value = selectedSet1;
        }
        if (set2 && selectedSet2 && Array.from(set2.options).some(option => option.value === selectedSet2)) {
            set2.value = selectedSet2;
        }

        if (set1) {
            updatePlaylistImage(set1);
        }
        if (set2) {
            updatePlaylistImage(set2);
        }

        setStatus(status, "Playlists refreshed.", "success");
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred.";
        setStatus(status, `Failed to refresh playlists: ${message}`, "error");
    } finally {
        playlistRefreshInProgress = false;
    }
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
    set1.onchange = () => updatePlaylistImage(set1);
    set2.onchange = () => updatePlaylistImage(set2);
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
    image.style.visibility = imageUrl ? "visible" : "hidden";
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

function orderPlaylistTracks(set1: Set<string>, set2: Set<string>, resultSet: Set<string>, order: PlaylistOrder): string[] {
    const set1Tracks = [...set1].filter(trackId => resultSet.has(trackId));
    const set2Tracks = [...set2].filter(trackId => resultSet.has(trackId));

    if (order === PlaylistOrder.Interlaced) {
        const interlacedTracks: string[] = [];
        const maxLength = Math.max(set1Tracks.length, set2Tracks.length);

        for (let index = 0; index < maxLength; index++) {
            if (set1Tracks[index]) {
                interlacedTracks.push(set1Tracks[index]);
            }
            if (set2Tracks[index] && interlacedTracks.indexOf(set2Tracks[index]) === -1) {
                interlacedTracks.push(set2Tracks[index]);
            }
        }

        return interlacedTracks;
    }

    const orderedTracks = Array.from(resultSet);
    if (order !== PlaylistOrder.Random) {
        return orderedTracks;
    }

    for (let index = orderedTracks.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [orderedTracks[index], orderedTracks[randomIndex]] =
            [orderedTracks[randomIndex], orderedTracks[index]];
    }

    return orderedTracks;
}
