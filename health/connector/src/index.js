/**
 * Google Health connector — a remote MCP server for Claude.
 *
 * Two OAuth layers meet here:
 *   1. Claude authorizes against this Worker (handled by OAuthProvider).
 *   2. This Worker authorizes against Google Health (handled below).
 *
 * Signing in with Google is what authenticates the user, so the two happen in
 * one pass: /authorize hands off to Google, /callback brings the result back.
 */

import { OAuthProvider, AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { HealthMcp } from "./mcp.js";
import { SCOPES, exchangeCode, fetchUserInfo, storeTokens } from "./google.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const callbackUrl = (request) => new URL("/callback", request.url).toString();

// ── Google sign-in ───────────────────────────────────────────────────────────

async function startGoogleSignIn(request, env, oauthRequest) {
  const state = crypto.randomUUID();
  await env.HEALTH_KV.put(`pending:${state}`, JSON.stringify(oauthRequest), { expirationTtl: 600 });

  const url = `${GOOGLE_AUTH_URL}?` + new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  callbackUrl(request),
    response_type: "code",
    scope:         SCOPES.join(" "),
    access_type:   "offline",   // ask for a refresh token
    prompt:        "consent",   // force one, even on re-authorization
    state,
  });

  return Response.redirect(url, 302);
}

async function finishGoogleSignIn(request, env) {
  const url   = new URL(request.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return page("Authorization failed", error, 400);
  if (!code || !state) return page("Authorization failed", "Missing code or state.", 400);

  const pending = await env.HEALTH_KV.get(`pending:${state}`);
  if (!pending) return page("Link expired", "That sign-in took too long. Start again from Claude.", 400);
  await env.HEALTH_KV.delete(`pending:${state}`);

  const tokens = await exchangeCode(env, code, callbackUrl(request));
  const user   = await fetchUserInfo(tokens.access_token);

  // A single-person connector: only the owner's Google account may connect.
  const allowed = (env.ALLOWED_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(user.email)) {
    return page("Not authorized", `${user.email} is not allowed to use this connector.`, 403);
  }

  await storeTokens(env, user.sub, tokens);

  const oauthRequest = JSON.parse(pending);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request:  oauthRequest,
    userId:   user.sub,
    metadata: { email: user.email },
    scope:    oauthRequest.scope,
    props:    { userId: user.sub, email: user.email },
  });

  return Response.redirect(redirectTo, 302);
}

function page(title, message, status = 200) {
  return new Response(
    `<html><body style="font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">
       <h2>${title}</h2><p>${message}</p>
     </body></html>`,
    { status, headers: { "Content-Type": "text/html" } },
  );
}

// ── Routes outside the protected API ─────────────────────────────────────────

const defaultHandler = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/callback") return finishGoogleSignIn(request, env);

    if (pathname === "/authorize") {
      let oauthRequest;
      try {
        oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch (err) {
        if (!(err instanceof AuthorizationError)) throw err;
        if (!err.redirectUri) return page("Invalid request", err.description, 400);

        const redirect = new URL(err.redirectUri);
        redirect.searchParams.set("error", err.code);
        redirect.searchParams.set("error_description", err.description);
        if (err.state)  redirect.searchParams.set("state", err.state);
        if (err.issuer) redirect.searchParams.set("iss", err.issuer);
        return Response.redirect(redirect.toString(), 302);
      }

      return startGoogleSignIn(request, env, oauthRequest);
    }

    if (pathname === "/") {
      return page("Google Health connector",
        "A personal MCP server. Add its /mcp URL as a custom connector in Claude.");
    }

    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute:    "/mcp",
  apiHandler:  HealthMcp,
  defaultHandler,

  authorizeEndpoint: "/authorize",
  tokenEndpoint:     "/oauth/token",

  scopesSupported: ["health:read", "health:write"],

  // `resource` is deliberately omitted: the provider derives it from the request,
  // so this works on workers.dev and a custom domain without reconfiguration.
  resourceMetadata: {
    scopes_supported: ["health:read", "health:write"],
    resource_name:    "Google Health",
  },

  clientIdMetadataDocumentEnabled: true,
  clientRegistrationEndpoint:      "/oauth/register",  // fallback for clients without CIMD
});
