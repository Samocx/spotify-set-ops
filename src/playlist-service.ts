import { SpotifyApiClient } from "./spotify-api-client";
import {
    applySetOperation,
    orderPlaylistTracks,
    PlaylistOrder,
    SetOperation
} from "./set-operations";

export class PlaylistService {
    constructor(private readonly api: SpotifyApiClient) {}

    async createSetPlaylist(
        firstPlaylistId: string,
        secondPlaylistId: string,
        operation: SetOperation,
        order: PlaylistOrder,
        name: string,
        description: string,
        signal?: AbortSignal
    ): Promise<number> {
        const firstSet = await this.api.getPlaylistSet(firstPlaylistId, signal);
        const secondSet = await this.api.getPlaylistSet(secondPlaylistId, signal);
        const resultSet = applySetOperation(firstSet, secondSet, operation);
        const orderedTracks = orderPlaylistTracks(firstSet, secondSet, resultSet, order);

        await this.api.createPlaylist(name, description, orderedTracks, signal);
        return resultSet.size;
    }
}
