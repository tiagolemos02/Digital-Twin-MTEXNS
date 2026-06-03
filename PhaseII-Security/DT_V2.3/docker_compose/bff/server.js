import cookieParser from "cookie-parser";
import crypto from "crypto";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const PORT = Number(process.env.BFF_PORT || process.env.PORT || 8001);
const PUBLIC_BASE_URL = process.env.BFF_PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const KEYROCK_BROWSER_URL = process.env.BFF_KEYROCK_BROWSER_URL || "http://localhost:3005";
const KEYROCK_INTERNAL_URL = process.env.BFF_KEYROCK_INTERNAL_URL || "http://keyrock:3005";
const SESSION_SECRET = process.env.BFF_SESSION_SECRET || "";
const KEYROCK_CLIENT_ID = process.env.KEYROCK_CLIENT_ID || "";
const KEYROCK_CLIENT_SECRET = process.env.KEYROCK_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.BFF_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/callback`;
const CALLBACK_PATH = new URL(REDIRECT_URI).pathname || "/auth/callback";
const FIWARE_BASE_URL = process.env.BFF_FIWARE_BASE_URL || "http://pep-proxy:1027";
const ADMIN_ROLE_NAME = (process.env.BFF_ADMIN_ROLE_NAME || "Admin").toLowerCase();
const ADMIN_NAME = process.env.BFF_KEYROCK_ADMIN_NAME || process.env.KEYROCK_ADMIN_EMAIL || "";
const ADMIN_PASS = process.env.BFF_KEYROCK_ADMIN_PASS || process.env.KEYROCK_ADMIN_PASS || "";

if (!KEYROCK_CLIENT_ID || !KEYROCK_CLIENT_SECRET) {
  console.error("Missing KEYROCK_CLIENT_ID or KEYROCK_CLIENT_SECRET in BFF environment.");
  process.exit(1);
}

if (!SESSION_SECRET) {
  console.error("Missing BFF_SESSION_SECRET in BFF environment.");
  process.exit(1);
}

const SESSION_COOKIE = "dt_bff_sid";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

let adminTokenCache = {
  token: "",
  expiresAt: 0
};

const app = express();
app.use(cookieParser());
// Keep proxied payloads as raw buffers; JSON/body parsers would consume and reshape them.
app.use("/bff/fiware", express.raw({ type: "*/*", limit: "10mb" }));
app.use("/bff/keyrock", express.raw({ type: "*/*", limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "2mb" }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

function now() {
  return Date.now();
}

function randomToken(bytes = 24) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(crypto.randomBytes(bytes))
    .update(String(now()))
    .digest("hex");
}

function setSessionCookie(res, sid) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/"
  });
}

function createSession(res) {
  const sid = randomToken(32);
  const session = {
    sid,
    createdAt: now(),
    touchedAt: now(),
    oauthState: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
    user: null,
    roleNames: []
  };

  sessions.set(sid, session);
  setSessionCookie(res, sid);
  return session;
}

function touchSession(session, res) {
  session.touchedAt = now();
  setSessionCookie(res, session.sid);
}

function getSession(req, res, { create = false } = {}) {
  const sid = req.cookies?.[SESSION_COOKIE] || "";

  if (sid && sessions.has(sid)) {
    const session = sessions.get(sid);
    if (now() - session.touchedAt > SESSION_TTL_MS) {
      sessions.delete(sid);
      clearSessionCookie(res);
      return create ? createSession(res) : null;
    }
    touchSession(session, res);
    return session;
  }

  if (!create) {
    return null;
  }

  return createSession(res);
}

function destroySession(req, res) {
  const sid = req.cookies?.[SESSION_COOKIE] || "";
  if (sid) {
    sessions.delete(sid);
  }
  clearSessionCookie(res);
}

function keyrockExternalLogoutUrl() {
  // Use Keyrock's method override to trigger DELETE from a browser navigation and
  // let Keyrock redirect back to the app URL configured for this OAuth client.
  const logoutUrl = new URL("/auth/external_logout", KEYROCK_BROWSER_URL);
  logoutUrl.searchParams.set("_method", "DELETE");
  logoutUrl.searchParams.set("client_id", KEYROCK_CLIENT_ID);
  return logoutUrl.toString();
}

function basicAuthorizationHeader() {
  const raw = `${KEYROCK_CLIENT_ID}:${KEYROCK_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function buildTokenRequestBody(fields) {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length > 0) {
      body.set(k, String(v));
    }
  });
  return body;
}

async function exchangeAuthorizationCode(code) {
  const body = buildTokenRequestBody({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI
  });

  const response = await fetch(`${KEYROCK_INTERNAL_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthorizationHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Authorization code exchange failed (HTTP ${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

async function refreshAccessToken(session) {
  if (!session.refreshToken) {
    return false;
  }

  const body = buildTokenRequestBody({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken
  });

  const response = await fetch(`${KEYROCK_INTERNAL_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthorizationHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const text = await response.text();
  if (!response.ok) {
    console.warn(`Refresh token exchange failed (HTTP ${response.status}): ${text}`);
    return false;
  }

  const payload = JSON.parse(text);
  session.accessToken = payload.access_token || session.accessToken;
  session.refreshToken = payload.refresh_token || session.refreshToken;
  session.expiresAt = now() + Math.max((Number(payload.expires_in) || 3600) - 30, 30) * 1000;
  return Boolean(session.accessToken);
}

async function ensureAccessToken(session) {
  if (!session?.accessToken) {
    return false;
  }

  if (!session.expiresAt || session.expiresAt > now() + 15_000) {
    return true;
  }

  return refreshAccessToken(session);
}

function collectRoleNames(userInfo) {
  const names = new Set();

  const addRoles = (roles) => {
    if (!Array.isArray(roles)) return;
    roles.forEach((role) => {
      if (typeof role === "string") {
        names.add(role.toLowerCase());
        return;
      }
      if (role && typeof role.name === "string") {
        names.add(role.name.toLowerCase());
      }
    });
  };

  addRoles(userInfo?.roles);

  if (Array.isArray(userInfo?.applications)) {
    userInfo.applications.forEach((application) => addRoles(application?.roles));
  }

  if (Array.isArray(userInfo?.apps)) {
    userInfo.apps.forEach((application) => addRoles(application?.roles));
  }

  return [...names];
}

async function fetchUserInfo(accessToken) {
  const url = `${KEYROCK_INTERNAL_URL}/user?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Unable to fetch user profile from Keyrock (HTTP ${response.status}): ${body}`);
  }

  return response.json();
}

function sanitizeUser(userInfo, roleNames) {
  return {
    id: userInfo?.id || "",
    username: userInfo?.username || "",
    email: userInfo?.email || "",
    roles: roleNames
  };
}

function isAdminSession(session) {
  return Array.isArray(session?.roleNames) && session.roleNames.includes(ADMIN_ROLE_NAME);
}

async function getAdminApiToken() {
  if (adminTokenCache.token && adminTokenCache.expiresAt > now()) {
    return adminTokenCache.token;
  }

  if (!ADMIN_NAME || !ADMIN_PASS) {
    throw new Error("BFF admin credentials are not configured.");
  }

  const response = await fetch(`${KEYROCK_INTERNAL_URL}/v1/auth/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: ADMIN_NAME,
      password: ADMIN_PASS
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Unable to obtain Keyrock admin API token (HTTP ${response.status}): ${body}`);
  }

  const token = response.headers.get("x-subject-token") || "";
  if (!token) {
    throw new Error("Keyrock admin API token response missing X-Subject-Token header.");
  }

  adminTokenCache = {
    token,
    expiresAt: now() + 5 * 60 * 1000
  };

  return token;
}

function buildForwardHeaders(req) {
  const headers = {};
  const passThrough = [
    "accept",
    "content-type",
    "fiware-service",
    "fiware-servicepath",
    "fiware-correlator",
    "ngsild-tenant",
    "ngsild-path"
  ];

  passThrough.forEach((name) => {
    const value = req.get(name);
    if (value) {
      headers[name] = value;
    }
  });

  return headers;
}

function applyProxyBody(req, requestInit) {
  if (["GET", "HEAD"].includes(req.method.toUpperCase())) {
    return;
  }

  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > 0) {
      requestInit.body = req.body;
    }
    return;
  }

  if (typeof req.body === "string") {
    if (req.body.length > 0) {
      requestInit.body = req.body;
    }
    return;
  }

  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    const contentType = String(req.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/x-www-form-urlencoded")) {
      requestInit.body = new URLSearchParams(req.body).toString();
      return;
    }
    requestInit.body = JSON.stringify(req.body);
  }
}

async function relayFetchResponse(upstream, res) {
  res.status(upstream.status);

  const passHeaders = ["content-type", "location"];
  passHeaders.forEach((headerName) => {
    const value = upstream.headers.get(headerName);
    if (value) {
      res.setHeader(headerName, value);
    }
  });

  if (upstream.status === 204) {
    res.end();
    return;
  }

  const payload = Buffer.from(await upstream.arrayBuffer());
  res.send(payload);
}

function requireAuthenticatedSession(req, res, next) {
  const session = getSession(req, res);
  if (!session?.accessToken) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.bffSession = session;
  next();
}

app.get("/auth/login", (req, res) => {
  // Always rotate local session state before a new OAuth login attempt.
  destroySession(req, res);
  const session = createSession(res);
  session.oauthState = randomToken(24);

  const authorizeUrl = new URL("/oauth2/authorize", KEYROCK_BROWSER_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", KEYROCK_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", "perms");
  authorizeUrl.searchParams.set("state", session.oauthState);
  authorizeUrl.searchParams.set("prompt", "login");
  authorizeUrl.searchParams.set("max_age", "0");

  res.redirect(authorizeUrl.toString());
});

app.get(CALLBACK_PATH, async (req, res) => {
  const session = getSession(req, res, { create: true });
  const { code = "", state = "", error = "", error_description: errorDescription = "" } = req.query;

  if (error) {
    destroySession(req, res);
    const message = encodeURIComponent(String(errorDescription || error));
    res.redirect(`/?auth_error=${message}`);
    return;
  }

  if (!code || !state || !session.oauthState || session.oauthState !== state) {
    destroySession(req, res);
    res.redirect("/?auth_error=invalid_oauth_state");
    return;
  }

  try {
    const tokenPayload = await exchangeAuthorizationCode(String(code));
    session.accessToken = tokenPayload.access_token || "";
    session.refreshToken = tokenPayload.refresh_token || "";
    session.expiresAt = now() + Math.max((Number(tokenPayload.expires_in) || 3600) - 30, 30) * 1000;

    const userInfo = await fetchUserInfo(session.accessToken);
    session.roleNames = collectRoleNames(userInfo);
    session.user = sanitizeUser(userInfo, session.roleNames);
    session.oauthState = "";

    res.redirect("/");
  } catch (err) {
    console.error("OAuth callback failed:", err);
    destroySession(req, res);
    res.redirect("/?auth_error=oauth_callback_failed");
  }
});

app.get("/auth/session", async (req, res) => {
  const session = getSession(req, res);

  if (!session?.accessToken) {
    res.json({ authenticated: false });
    return;
  }

  const valid = await ensureAccessToken(session);
  if (!valid) {
    destroySession(req, res);
    res.json({ authenticated: false });
    return;
  }

  if (!session.user) {
    try {
      const userInfo = await fetchUserInfo(session.accessToken);
      session.roleNames = collectRoleNames(userInfo);
      session.user = sanitizeUser(userInfo, session.roleNames);
    } catch (err) {
      console.error("Failed to refresh user session details:", err);
      destroySession(req, res);
      res.json({ authenticated: false });
      return;
    }
  }

  res.json({
    authenticated: true,
    user: session.user
  });
});

app.get("/auth/logout", (req, res) => {
  destroySession(req, res);
  res.redirect(keyrockExternalLogoutUrl());
});

app.post("/auth/logout", (req, res) => {
  destroySession(req, res);
  res.json({
    success: true,
    keyrock_logout_url: keyrockExternalLogoutUrl()
  });
});

app.all("/bff/fiware/*", requireAuthenticatedSession, async (req, res) => {
  const session = req.bffSession;
  const valid = await ensureAccessToken(session);

  if (!valid) {
    destroySession(req, res);
    res.status(401).json({ error: "Session expired" });
    return;
  }

  const suffix = req.originalUrl.replace(/^\/bff\/fiware/, "");
  const targetUrl = new URL(suffix, FIWARE_BASE_URL).toString();
  const headers = buildForwardHeaders(req);
  headers.Authorization = `Bearer ${session.accessToken}`;
  headers["X-Auth-Token"] = session.accessToken;

  const requestInit = {
    method: req.method,
    headers,
    redirect: "manual"
  };

  applyProxyBody(req, requestInit);

  try {
    const upstream = await fetch(targetUrl, requestInit);
    await relayFetchResponse(upstream, res);
  } catch (err) {
    console.error("FIWARE proxy error:", err);
    res.status(502).json({ error: "Failed to reach FIWARE upstream" });
  }
});

app.all("/bff/keyrock/*", requireAuthenticatedSession, async (req, res) => {
  const session = req.bffSession;

  if (!isAdminSession(session)) {
    res.status(403).json({ error: "Admin role required" });
    return;
  }

  const suffix = req.originalUrl.replace(/^\/bff\/keyrock/, "");
  const targetUrl = new URL(suffix, KEYROCK_INTERNAL_URL).toString();
  const headers = buildForwardHeaders(req);

  try {
    if (suffix.startsWith("/v1/")) {
      headers["X-Auth-Token"] = await getAdminApiToken();
    } else {
      const valid = await ensureAccessToken(session);
      if (!valid) {
        destroySession(req, res);
        res.status(401).json({ error: "Session expired" });
        return;
      }
      headers.Authorization = `Bearer ${session.accessToken}`;
      headers["X-Auth-Token"] = session.accessToken;
    }

    const requestInit = {
      method: req.method,
      headers,
      redirect: "manual"
    };

    applyProxyBody(req, requestInit);

    const upstream = await fetch(targetUrl, requestInit);
    await relayFetchResponse(upstream, res);
  } catch (err) {
    console.error("Keyrock proxy error:", err);
    res.status(502).json({ error: "Failed to reach Keyrock upstream" });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "portal-bff"
  });
});

app.use(express.static(publicDir, { index: "index.html" }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/auth/") || req.path.startsWith("/bff/")) {
    next();
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

setInterval(() => {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [sid, session] of sessions.entries()) {
    if (session.touchedAt < cutoff) {
      sessions.delete(sid);
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`portal-bff listening on port ${PORT}`);
  console.log(`Using Keyrock internal URL: ${KEYROCK_INTERNAL_URL}`);
  console.log(`Using Keyrock browser URL: ${KEYROCK_BROWSER_URL}`);
  console.log(`Using redirect URI: ${REDIRECT_URI}`);
});
