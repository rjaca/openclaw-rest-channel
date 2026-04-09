import type { ChannelConfig, OpenClawPluginApi } from "./types.js";
import { ResponseBridge, createChannelPlugin } from "./channel.js";
import { createRestServer } from "./server.js";

const plugin = {
  id: "rest-channel",
  name: "REST Channel",
  description: "Generic REST API channel for external devices and services",

  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig ?? {}) as ChannelConfig;
    const port = config.port ?? 7800;
    const runtime = api.runtime;

    // Shared bridge between the HTTP server and channel outbound
    const bridge = new ResponseBridge();

    // Register the channel plugin with the gateway
    const channelPlugin = createChannelPlugin(bridge);
    api.registerChannel({ plugin: channelPlugin });

    // Create the HTTP server — pass runtime for message dispatch
    const server = createRestServer(config, api, bridge, runtime);

    server.listen(port, () => {
      api.logger.info(`REST Channel listening on port ${port}`);
    });
    server.on("error", (err) => {
      // EADDRINUSE is expected — register() is called multiple times by the SDK
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") return;
      api.logger.error(`REST Channel server error: ${(err as Error).message}`);
    });

    api.registerService({
      id: "rest-channel-http",
      start: async (_ctx) => {},
      stop: async (_ctx) => {
        bridge.clear();
        server.close(() => {
          api.logger.info("REST Channel server stopped");
        });
      },
    });
  },
};

export default plugin;
