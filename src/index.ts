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

    // Register as a managed service for lifecycle control
    api.registerService({
      id: "rest-channel-http",
      start: async (_ctx) => {
        server.listen(port, () => {
          api.logger.info(`REST Channel listening on port ${port}`);
        });
      },
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
