import { useEffect, useState } from "react";
import { Designer } from "../../src/designer";
import { Nav } from "../../src/nav";

import { randUserInfo } from "../../src/client-state";
import { randomShape } from "../../src/shape";
import { Rep } from "../../src/rep";

export default function Home() {
  const [rep, setRep] = useState<Rep | null>(null);

  // TODO: Think through Replicache + SSR.
  useEffect(() => {
    (async () => {
      if (rep) {
        return;
      }

      const url = new URL(location.href);
      const [, , room] = url.pathname.split("/");
      const wantsProd = url.searchParams.get("prod-worker");
      const isProd =
        (wantsProd !== null &&
          (wantsProd === "1" || wantsProd.toLowerCase() === "true")) ||
        url.host.indexOf(".vercel.app") > -1;
      const workerHost = isProd
        ? `replicache-worker.replicache.workers.dev`
        : `127.0.0.1:8787`;
      const workerSecureSuffix = isProd ? "s" : "";

      const workerURL = (
        protocol: string,
        path: string,
        qs = new URLSearchParams()
      ) => {
        qs.set("room", room);
        return `${protocol}${workerSecureSuffix}://${workerHost}/${path}?${qs.toString()}`;
      };

      const r = await Rep.new({
        pushURL: workerURL("http", "replicache-push"),
        pullURL: workerURL("http", "replicache-pull"),
      });

      const defaultUserInfo = randUserInfo();
      r.mutate.initClientState({ id: await r.clientID, defaultUserInfo });
      r.onSync = (syncing: boolean) => {
        if (!syncing) {
          r.onSync = null;
          r.mutate.initShapes(new Array(5).fill(null).map(() => randomShape()));
        }
      };
      await r.pull();

      let ws: WebSocket;

      const initSocket = async () => {
        if (
          ws !== undefined &&
          (ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING)
        ) {
          return;
        }
        console.debug("Connecting WebSocket...");
        ws = new WebSocket(
          workerURL(
            "ws",
            `replicache-poke`,
            new URLSearchParams([["clientID", r.cid]])
          )
        );
        ws.onopen = () => {
          console.log("Connected to WebSocket");
          r.pull();
        };
        ws.onmessage = async (e) => {
          const data = JSON.parse(e.data);
          try {
            await r.experimentalApplyPullResponse(
              data.baseCookie,
              data.response
            );
          } catch (e) {
            if (e.toString().indexOf("Overlapping syncs") > -1) {
              console.warn("Got overlapping syncs error - pulling manually");
              r.pull();
              return;
            }
            throw e;
          }
        };
        ws.onerror = (e) => {
          console.error("Error from WebSocket", e);
        };
        ws.onclose = () => {
          console.log(
            "Disconnected from WebSocket. Will reconnect on next interaction"
          );
        };
      };
      initSocket();

      // TODO: This is a hack to make sure the socket is connected. Do this properly with
      // addEventListener(), but need to removeEventListener() too and can't do that because
      // this is async, gar.
      window.onfocus = initSocket;
      window.onmousemove = initSocket;
      window.ontouchstart = initSocket;

      setRep(r);
    })();
  }, []);

  if (!rep) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        flexDirection: "column",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        background: "rgb(229,229,229)",
      }}
    >
      <Nav rep={rep} />
      <Designer {...{ rep }} />
    </div>
  );
}
