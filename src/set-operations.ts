export enum SetOperation {
    Union = "union",
    Intersection = "intersection",
    Difference = "difference",
    SymmetricDifference = "symmetric-difference"
}

export enum PlaylistOrder {
    Default = "default",
    Interlaced = "interlaced",
    Random = "random"
}

export function applySetOperation(set1: Set<string>, set2: Set<string>, operation: SetOperation): Set<string> {
    switch (operation) {
        case SetOperation.Union:
            return new Set([...set1, ...set2]);
        case SetOperation.Intersection:
            return new Set([...set1].filter(trackId => set2.has(trackId)));
        case SetOperation.Difference:
            return new Set([...set1].filter(trackId => !set2.has(trackId)));
        case SetOperation.SymmetricDifference:
            return new Set([...set1, ...set2].filter(trackId => set1.has(trackId) !== set2.has(trackId)));
    }
}

export function orderPlaylistTracks(set1: Set<string>, set2: Set<string>, resultSet: Set<string>, order: PlaylistOrder): string[] {
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
