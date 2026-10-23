// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, loadAvatarConfig, mergeAvatarConfig, saveAvatarConfig } from "./avatarConfig";
import { AVATAR_CONFIG_EVENT, handleRemoteAvatarConfig, publishAvatarConfig, subscribeAvatarConfig } from "./avatarSync";

describe("avatar config sync", () => {
  beforeEach(() => localStorage.clear());

  it("merges partial configs over the defaults, including nested colors", () => {
    const merged = mergeAvatarConfig({ species: "perro", colors: { base: "#123456" } });
    expect(merged.species).toBe("perro");
    expect(merged.colors).toEqual({ ...DEFAULT_CONFIG.colors, base: "#123456" });
    expect(mergeAvatarConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("stores a remote config and notifies subscribers", () => {
    const seen = vi.fn();
    const off = subscribeAvatarConfig(seen);
    handleRemoteAvatarConfig({ species: "erizo" }, null);
    expect(loadAvatarConfig().species).toBe("erizo");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].species).toBe("erizo");
    handleRemoteAvatarConfig({ species: "erizo" }, null); // same config: no echo
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    expect(AVATAR_CONFIG_EVENT).toBe("kali:avatar-config");
  });

  it("seeds the core with a locally customized avatar when it has none", () => {
    const client = { send: vi.fn() };
    handleRemoteAvatarConfig(null, client);
    expect(client.send).not.toHaveBeenCalled();
    saveAvatarConfig({ ...DEFAULT_CONFIG, species: "perro" });
    handleRemoteAvatarConfig(null, client);
    expect(client.send).toHaveBeenCalledWith({ event: "avatar_config_set", config: expect.objectContaining({ species: "perro" }) });
  });

  it("publishes through the websocket client", () => {
    const client = { send: vi.fn() };
    publishAvatarConfig(client, DEFAULT_CONFIG);
    expect(client.send).toHaveBeenCalledWith({ event: "avatar_config_set", config: DEFAULT_CONFIG });
  });
});
