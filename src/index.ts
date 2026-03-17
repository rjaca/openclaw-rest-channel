import type { ChannelConfig, OpenClawPluginApi } from "./types.js";
import { ResponseBridge, createChannelPlugin } from "./channel.js";
import { createRestServer } from "./server.js";

const plugin = {
  id: "rest-channel",
  name: "REST Channel",
  description: "Generic REST API channel for external devices and services",

  register(api: OpenClawPluginApi) {
    const fullConfig = api.config as any;
    const pluginEntry = fullConfig.plugins?.entries?.["rest-channel"];
    const config = (pluginEntry?.config ?? {}) as ChannelConfig;
    const port = config.port ?? 7800;
    const runtime = (api as any).runtime;

    // Shared bridge between the HTTP server and channel outbound
    const bridge = new ResponseBridge();

    // Register the channel plugin with the gateway
    const channelPlugin = createChannelPlugin(bridge);
    api.registerChannel({ plugin: channelPlugin });

    // Create the HTTP server — pass runtime for message dispatch
    const server = createRestServer(config, api, bridge, runtime, fullConfig);

    // Register as a managed service for lifecycle control
    api.registerService({
      id: "rest-channel-http",
      start() {
        server.listen(port, () => {
          api.logger.info(`REST Channel listening on port ${port}`);
        });
      },
      stop() {
        bridge.clear();
        server.close(() => {
          api.logger.info("REST Channel server stopped");
        });
      },
    });
  },
};

export default plugin;
