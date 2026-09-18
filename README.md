# Spotify Set Operations

A small TypeScript web application for loading Spotify playlists and applying
set operations.

## Prerequisites

- Node.js and npm
- a Spotify account
- (optional) a Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

Node.js normally includes npm. You can check the installed versions with:

```bash
node --version
npm --version
```

## Clone the Repository

Using HTTPS:

```bash
git clone https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
```

Or using SSH if you have configured an SSH key with GitHub:

```bash
git clone git@github.com:YOUR-NAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
```

## Install Dependencies

Run this in the project directory:

```bash
npm install
```

This installs the dependencies from `package.json`.

## Configure the Spotify App (optional)

The Tool should work with the provided Client ID, but you can set up your own app:

1. Create or open an app in the Spotify Developer Dashboard.
2. Add the redirect URI `http://127.0.0.1:8080` in the app settings.
3. Add your app's Client ID to `src/index.ts`:

```ts
const clientId = "YOUR_SPOTIFY_CLIENT_ID";
```

The application uses the Authorization Code Flow with PKCE. A client secret
is not required for this browser flow and must not be added to the source code.

## Start the Development Server

```bash
npm run dev
```

Then open the application in your browser:

```text
http://127.0.0.1:8080
```

On the first visit, you will be asked to sign in to Spotify. You can then select
two playlists and apply a set operation to them.

## Check the Project

You can run the TypeScript compiler without generating output:

```bash
npx tsc --noEmit
```
