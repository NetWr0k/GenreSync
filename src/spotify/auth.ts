import * as http from "http";
import * as crypto from "crypto";
import fetch from "node-fetch";
import { config } from "../config";
import { tokenStore } from "../storage/store";
import { logger } from "../logger";
import { SpotifyTokens } from "../types";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generatePkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Runs the one-time interactive login flow:
 * opens a local server to catch Spotify's redirect, prints the auth URL
 * for the user to open, exchanges the code for tokens, and persists them.
 */
export async function runLoginFlow(): Promise<void> {
  const { verifier, challenge } = generatePkcePair();
  const state = base64url(crypto.randomBytes(16));

  const authUrl = new URL(SPOTIFY_AUTH_URL);
  authUrl.searchParams.set("client_id", config.spotify.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", config.spotify.redirectUri);
  authUrl.searchParams.set("scope", config.spotify.scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);

  const redirectUrl = new URL(config.spotify.redirectUri);
  const port = Number(redirectUrl.port) || config.auth.callbackPort;

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url) return;
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== redirectUrl.pathname) {
          res.writeHead(404);
          res.end();
          return;
        }

        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error || !code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>GenreSync login failed</h1><p>${error || "invalid state/code"}</p>`);
          server.close();
          reject(new Error(error || "OAuth callback validation failed"));
          return;
        }

        const tokens = await exchangeCodeForTokens(code, verifier);
        tokenStore.set(tokens);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>GenreSync connected to Spotify.</h1><p>You can close this tab.</p>");
        server.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    server.listen(port, () => {
      logger.info(`Open this URL in your browser to authorize GenreSync:\n\n${authUrl.toString()}\n`);
    });
  });
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.spotify.redirectUri,
    client_id: config.spotify.clientId,
    code_verifier: verifier,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64"),
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

async function refreshTokens(refreshToken: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.spotify.clientId,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64"),
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

/** Returns a valid access token, refreshing it first if it's expired or about to expire. */
export async function getValidAccessToken(): Promise<string> {
  const tokens = tokenStore.get();
  if (!tokens) {
    throw new Error("Not authenticated with Spotify yet. Run `npm run auth` first.");
  }

  const aboutToExpire = Date.now() > tokens.expiresAt - 60_000;
  if (!aboutToExpire) {
    return tokens.accessToken;
  }

  logger.debug("Access token expired or expiring soon, refreshing...");
  const refreshed = await refreshTokens(tokens.refreshToken);
  tokenStore.set(refreshed);
  return refreshed.accessToken;
}
