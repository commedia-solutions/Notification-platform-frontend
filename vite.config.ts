import { Buffer } from "node:buffer";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function signalOpsDevelopmentBridge(apiOrigin: string): Plugin {
  const upstreamOrigin = apiOrigin.replace(/\/$/, "");

  return {
    name: "signalops-development-api-bridge",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }

        try {
          const chunks: Uint8Array[] = [];
          for await (const chunk of request) {
            chunks.push(
              typeof chunk === "string"
                ? new TextEncoder().encode(chunk)
                : chunk,
            );
          }

          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (
              !value ||
              [
                "host",
                "origin",
                "content-length",
                "connection",
                "expect",
                "accept-encoding",
              ].includes(name)
            ) {
              continue;
            }
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }

          const method = request.method || "GET";
          const requestBody = Buffer.concat(chunks);
          const upstream = await fetch(`${upstreamOrigin}${request.url}`, {
            method,
            headers,
            body:
              method === "GET" || method === "HEAD" || !requestBody.length
                ? undefined
                : requestBody,
            redirect: "manual",
          });

          response.statusCode = upstream.status;
          response.statusMessage = upstream.statusText;
          upstream.headers.forEach((value, name) => {
            if (
              [
                "connection",
                "content-encoding",
                "content-length",
                "set-cookie",
                "transfer-encoding",
              ].includes(name.toLowerCase())
            ) {
              return;
            }
            response.setHeader(name, value);
          });

          const setCookie = upstream.headers.get("set-cookie");
          if (setCookie) {
            response.setHeader(
              "set-cookie",
              setCookie
                .replace(/;\s*Secure/gi, "")
                .replace(/;\s*SameSite=None/gi, "; SameSite=Lax"),
            );
          }

          response.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          console.error("SignalOps development API bridge failed", error);
          response.statusCode = 502;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "DEVELOPMENT_PROXY_FAILED",
                message: "The local development server could not reach the SignalOps API",
              },
            }),
          );
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiTarget =
    env.DEV_API_PROXY_TARGET || "https://signalops-api.iot-cspllabs.com";

  return {
    plugins: [signalOpsDevelopmentBridge(apiTarget), react()],
    server: {
      port: 5173,
    },
  };
});
