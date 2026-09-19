const refreshTokenStorageKey = "spotify_refresh_token";

export class SpotifyAuth {
    private readonly verifierLength: number = 128;
    private verifier: string = '';
    private accessToken: string = '';
    private refreshToken: string = '';

    constructor(
        private readonly clientId: string,
        private readonly urlCode: string | null,
        private readonly redirectUri: string,
        private readonly scope: string
    ) {
        this.refreshToken = sessionStorage.getItem(refreshTokenStorageKey) ?? '';
    }

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

        window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
    }

    private generateCodeVerifier(length: number): void {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';

        for (let index = 0; index < length; index++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }

        this.verifier = text;
    }

    private async generateCodeChallenge(): Promise<string> {
        const data = new TextEncoder().encode(this.verifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async authenticate(): Promise<void> {
        const verifier = localStorage.getItem("verifier");
        if (!verifier || !this.urlCode) {
            throw new Error("Missing authorization code or PKCE verifier.");
        }

        const params = new URLSearchParams();
        params.append("client_id", this.clientId);
        params.append("grant_type", "authorization_code");
        params.append("code", this.urlCode);
        params.append("redirect_uri", this.redirectUri);
        params.append("code_verifier", verifier);

        const result = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const responseText = await result.text();
        if (!result.ok) {
            throw new Error(`Token request failed: ${result.status} ${responseText}`);
        }

        const payload = this.parseTokenResponse(responseText, "token endpoint");
        if (!payload.access_token) {
            throw new Error(`No access token in token response: ${responseText}`);
        }

        this.accessToken = payload.access_token;
        this.refreshToken = payload.refresh_token ?? this.refreshToken;
        this.storeRefreshToken();
        localStorage.removeItem("verifier");
    }

    getAccessToken(): string {
        if (!this.accessToken) {
            throw new Error("Not authenticated");
        }

        return this.accessToken;
    }

    hasRefreshToken(): boolean {
        return Boolean(this.refreshToken);
    }

    async refreshAccessToken(): Promise<void> {
        if (!this.refreshToken) {
            throw new Error("Session expired. Please authenticate with Spotify again.");
        }

        const params = new URLSearchParams({
            client_id: this.clientId,
            grant_type: "refresh_token",
            refresh_token: this.refreshToken
        });

        const result = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const responseText = await result.text();
        if (!result.ok) {
            throw new Error(`Token refresh failed: ${result.status} ${responseText}`);
        }

        const payload = this.parseTokenResponse(responseText, "token refresh");
        if (!payload.access_token) {
            throw new Error(`No access token in refresh response: ${responseText}`);
        }

        this.accessToken = payload.access_token;
        this.refreshToken = payload.refresh_token ?? this.refreshToken;
        this.storeRefreshToken();
    }

    private storeRefreshToken(): void {
        if (this.refreshToken) {
            sessionStorage.setItem(refreshTokenStorageKey, this.refreshToken);
        }
    }

    private parseTokenResponse(responseText: string, requestName: string): any {
        try {
            return JSON.parse(responseText);
        } catch {
            throw new Error(`Invalid JSON from ${requestName}: ${responseText}`);
        }
    }
}
